import * as THREE from "three";
import { createHumanBust, HUMAN_BUST_HEIGHT, humanBustDistance, projectOutOfHumanBust } from "@/simulate/humanBust";
import type { SolidKey } from "@/simulate/simulate.types";

export type Solid = {
  label: string;
  topY: number;
  boundingRadius: number;
  centerY: number;
  sdf: (x: number, y: number, z: number) => number;
  createMesh: (material: THREE.Material) => THREE.Object3D;
  projectOut?: (positions: Float32Array, offset: number, margin: number) => boolean;
};

export const SOLIDS: Record<SolidKey, Solid> = {
  human: {
    label: "Androgenous Human",
    topY: HUMAN_BUST_HEIGHT,
    boundingRadius: 3,
    centerY: HUMAN_BUST_HEIGHT / 2,
    sdf: humanBustDistance,
    createMesh: createHumanBust,
    projectOut: projectOutOfHumanBust,
  },
};

export const createSolidMaterial = () => new THREE.MeshStandardMaterial({ color: 0x8fa3a8, roughness: 0.55 });

export const enableShadows = <T extends THREE.Object3D>(object: T): T => {
  object.traverse((child) => {
    child.castShadow = true;
    child.receiveShadow = true;
  });
  return object;
};

export const disposeObject = (object: THREE.Object3D) => {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
      child.geometry.dispose();
    }
  });
};

export const pushOutOfSolid = (solid: Solid, positions: Float32Array, offset: number, margin: number) => {
  if (solid.boundingRadius === 0) return false;
  const x = positions[offset];
  const y = positions[offset + 1];
  const z = positions[offset + 2];
  if (x * x + (y - solid.centerY) ** 2 + z * z > solid.boundingRadius * solid.boundingRadius) return false;
  if (solid.projectOut) return solid.projectOut(positions, offset, margin);

  const distance = solid.sdf(x, y, z);
  if (distance >= margin) return false;

  const h = 1e-3;
  const sdf = solid.sdf;
  const gx = sdf(x + h, y, z) - sdf(x - h, y, z);
  const gy = sdf(x, y + h, z) - sdf(x, y - h, z);
  const gz = sdf(x, y, z + h) - sdf(x, y, z - h);
  const scale = (margin - distance) / (Math.hypot(gx, gy, gz) || 1);
  positions[offset] += gx * scale;
  positions[offset + 1] += gy * scale;
  positions[offset + 2] += gz * scale;
  return true;
};
