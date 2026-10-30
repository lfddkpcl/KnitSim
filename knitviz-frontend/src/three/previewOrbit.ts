import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/Addons.js";

export interface PreviewOrbitOptions {
  target?: THREE.Vector3;
  minDistance?: number;
  maxDistance?: number;
  onChange?: () => void;
}

export interface FrameOptions {
  direction?: THREE.Vector3;
  padding?: number;
}

export class PreviewOrbit {
  readonly controls: OrbitControls;
  private readonly onChange?: () => void;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    element: HTMLElement,
    options: PreviewOrbitOptions = {},
  ) {
    this.controls = new OrbitControls(camera, element);
    this.controls.enablePan = false;
    this.controls.enableDamping = false;
    this.controls.minPolarAngle = 0;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.minAzimuthAngle = -Infinity;
    this.controls.maxAzimuthAngle = Infinity;
    this.controls.minDistance = options.minDistance ?? 1;
    this.controls.maxDistance = options.maxDistance ?? 650;

    if (options.target) {
      this.controls.target.copy(options.target);
    }

    this.onChange = options.onChange;
    if (this.onChange) {
      this.controls.addEventListener("change", this.onChange);
    }
    this.controls.update();
    this.controls.saveState();
  }

  get target() {
    return this.controls.target;
  }

  get enabled() {
    return this.controls.enabled;
  }

  set enabled(enabled: boolean) {
    this.controls.enabled = enabled;
  }

  focus(target: THREE.Vector3) {
    const shift = target.clone().sub(this.controls.target);
    this.camera.position.add(shift);
    this.controls.target.copy(target);
    this.controls.update();
    this.controls.saveState();
  }

  frame(bounds: THREE.Box3, options: FrameOptions = {}) {
    if (bounds.isEmpty()) {
      return;
    }

    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const center = sphere.center;
    const radius = Math.max(sphere.radius, 0.5);
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect);
    const limitingFov = Math.max(Math.min(verticalFov, horizontalFov), 0.01);
    const distance = (radius / Math.sin(limitingFov / 2)) * (options.padding ?? 1.1);
    const direction = (options.direction ?? this.camera.position.clone().sub(this.controls.target))
      .clone()
      .normalize();

    if (direction.lengthSq() === 0) {
      direction.set(0, 0, -1);
    }

    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.controls.saveState();
  }

  update() {
    this.controls.update();
  }

  dispose() {
    if (this.onChange) {
      this.controls.removeEventListener("change", this.onChange);
    }
    this.controls.dispose();
  }
}
