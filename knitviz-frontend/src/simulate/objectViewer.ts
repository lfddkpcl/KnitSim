import * as THREE from "three";
import { createSolidMaterial, disposeObject, SOLIDS } from "@/simulate/solids";
import type { SolidKey } from "@/simulate/simulate.types";
import { PreviewOrbit } from "@/three/previewOrbit";

export class ObjectViewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  private readonly orbit: PreviewOrbit;
  private readonly material = createSolidMaterial();
  private solidObject: THREE.Object3D | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setClearAlpha(0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera.position.set(4, 3.2, 5);
    this.orbit = new PreviewOrbit(this.camera, canvas, {
      target: new THREE.Vector3(0, 1, 0),
      minDistance: 2.5,
      maxDistance: 20,
      onChange: () => this.render(),
    });

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c4cc, 1.15));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(4, 7, 5);
    this.scene.add(keyLight);
  }

  show(solid: SolidKey) {
    this.clearSolidObject();
    this.solidObject = SOLIDS[solid].createMesh(this.material);
    this.scene.add(this.solidObject);
    this.resize();
    this.frame();
  }

  resize() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  frame() {
    if (this.solidObject) {
      this.orbit.frame(new THREE.Box3().setFromObject(this.solidObject), {
        direction: new THREE.Vector3(0.75, 0.55, 1),
        padding: 1.35,
      });
    }
    this.render();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.clearSolidObject();
    this.material.dispose();
    this.orbit.dispose();
    this.renderer.dispose();
  }

  private clearSolidObject() {
    if (!this.solidObject) return;
    this.scene.remove(this.solidObject);
    disposeObject(this.solidObject);
    this.solidObject = null;
  }
}
