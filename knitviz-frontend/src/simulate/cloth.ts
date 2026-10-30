import * as THREE from "three";
import { pushOutOfSolid, type Solid } from "@/simulate/solids";
import type { FabricLayout } from "@/simulate/simulate.types";

const GRAVITY = -9.81;
export const CONTACT_MARGIN = 0.035;

export enum SpringType {
  STRUCTURAL = 0,
  SHEAR = 1,
  BEND = 2,
}

export type ClothBuildOptions = {
  layout: FabricLayout;
  stitchWidth: number;
  textureTile: number;
  solidTop: number;
};

export type ClothStepParams = {
  stretch: number;
  bend: number;
  friction: number;
  weight: number;
  damping: number;
  drag: number;
  iterations: number;
};

export class Cloth {
  readonly nodeCount: number;
  readonly springCount: number;
  readonly geometry = new THREE.BufferGeometry();
  readonly springGeometry = new THREE.BufferGeometry();
  accumulatedMovement = 0;

  private readonly positions: Float32Array;
  private readonly previous: Float32Array;
  private readonly springA: Int32Array;
  private readonly springB: Int32Array;
  private readonly springType: Uint8Array;
  private readonly restLength: Float32Array;

  constructor({ layout, stitchWidth, textureTile, solidTop }: ClothBuildOptions) {
    const rowLengths = layout.rowLengths;
    const rowCount = rowLengths.length;
    const n = rowLengths.reduce((sum, rowLength) => sum + rowLength, 0);
    this.nodeCount = n;

    const positions = new Float32Array(n * 3);
    const uvs = new Float32Array(n * 2);
    const rowIndex: number[][] = [];
    const rowParams: number[][] = [];

    const yaw = 0.18;
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const startY = Math.max(2.4, solidTop + 1.6);

    let idx = 0;
    for (let r = 0; r < rowCount; r++) {
      const nr = rowLengths[r];
      const ids: number[] = [];
      const params: number[] = [];
      for (let c = 0; c < nr; c++) {
        const k = idx * 3;
        const lx = (c - (nr - 1) / 2) * stitchWidth;
        const lz = (r - (rowCount - 1) / 2) * stitchWidth;
        positions[k] = lx * cosYaw - lz * sinYaw;
        positions[k + 1] = startY + (Math.random() - 0.5) * 0.004;
        positions[k + 2] = lx * sinYaw + lz * cosYaw;
        uvs[idx * 2] = lx / textureTile;
        uvs[idx * 2 + 1] = lz / textureTile;
        ids.push(idx);
        params.push(lx);
        idx++;
      }
      rowIndex.push(ids);
      rowParams.push(params);
    }
    this.positions = positions;
    this.previous = positions.slice();

    const nearest = (params: number[], u: number) => {
      let best = 0;
      let bestDistance = Infinity;
      for (let i = 0; i < params.length; i++) {
        const d = Math.abs(params[i] - u);
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      }
      return best;
    };
    const rowIndexAt = (i: number, nr: number) => (i >= 0 && i < nr ? i : -1);

    const springA: number[] = [];
    const springB: number[] = [];
    const springType: SpringType[] = [];
    const seen = new Set<number>();
    const addSpring = (a: number, b: number, type: SpringType) => {
      if (a < 0 || b < 0 || a === b) return;
      const key = a < b ? a * n + b : b * n + a;
      if (seen.has(key)) return;
      seen.add(key);
      springA.push(a);
      springB.push(b);
      springType.push(type);
    };

    for (let r = 0; r < rowCount; r++) {
      const ids = rowIndex[r];
      const nr = ids.length;
      const params = rowParams[r];
      for (let c = 0; c < nr; c++) {
        const next = rowIndexAt(c + 1, nr);
        const nextButOne = rowIndexAt(c + 2, nr);
        if (next >= 0 && (nr > 2 || c + 1 < nr)) addSpring(ids[c], ids[next], SpringType.STRUCTURAL);
        if (nextButOne >= 0 && nr > 4) addSpring(ids[c], ids[nextButOne], SpringType.BEND);
        if (r > 0) {
          const below = rowIndex[r - 1];
          const j = nearest(rowParams[r - 1], params[c]);
          addSpring(ids[c], below[j], SpringType.STRUCTURAL);
          const left = rowIndexAt(j - 1, below.length);
          const right = rowIndexAt(j + 1, below.length);
          if (left >= 0) addSpring(ids[c], below[left], SpringType.SHEAR);
          if (right >= 0) addSpring(ids[c], below[right], SpringType.SHEAR);
        }
        if (r > 1) addSpring(ids[c], rowIndex[r - 2][nearest(rowParams[r - 2], params[c])], SpringType.BEND);
      }
      if (r > 0) {
        const below = rowIndex[r - 1];
        for (let j = 0; j < below.length; j++) {
          addSpring(below[j], ids[nearest(params, rowParams[r - 1][j])], SpringType.STRUCTURAL);
        }
      }
    }

    this.springCount = springA.length;
    this.springA = Int32Array.from(springA);
    this.springB = Int32Array.from(springB);
    this.springType = Uint8Array.from(springType);
    this.restLength = new Float32Array(this.springCount);
    for (let q = 0; q < this.springCount; q++) {
      const a = this.springA[q] * 3;
      const b = this.springB[q] * 3;
      const dx = positions[a] - positions[b];
      const dy = positions[a + 1] - positions[b + 1];
      const dz = positions[a + 2] - positions[b + 2];
      this.restLength[q] = Math.hypot(dx, dy, dz);
    }

    const triangles: number[] = [];
    for (let r = 1; r < rowCount; r++) {
      const idsA = rowIndex[r - 1].slice();
      const paramsA = rowParams[r - 1].slice();
      const idsB = rowIndex[r].slice();
      const paramsB = rowParams[r].slice();
      let i = 0;
      let j = 0;
      while (i < idsA.length - 1 || j < idsB.length - 1) {
        if (j >= idsB.length - 1 || (i < idsA.length - 1 && paramsA[i + 1] <= paramsB[j + 1])) {
          triangles.push(idsA[i], idsA[i + 1], idsB[j]);
          i++;
        } else {
          triangles.push(idsA[i], idsB[j + 1], idsB[j]);
          j++;
        }
      }
    }

    const positionAttribute = new THREE.BufferAttribute(positions, 3);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("position", positionAttribute);
    this.geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    this.geometry.setIndex(triangles);
    this.geometry.computeVertexNormals();

    const structuralIndices: number[] = [];
    for (let q = 0; q < this.springCount; q++) {
      if (this.springType[q] === SpringType.STRUCTURAL) structuralIndices.push(this.springA[q], this.springB[q]);
    }
    this.springGeometry.setAttribute("position", positionAttribute);
    this.springGeometry.setIndex(structuralIndices);
  }

  step(dt: number, params: ClothStepParams, solid: Solid) {
    const { positions: pos, previous: prev, nodeCount: n } = this;
    const gravity = GRAVITY * dt * dt * params.weight;
    const damping = params.damping * (1 - params.drag);

    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const vx = (pos[k] - prev[k]) * damping;
      const vy = (pos[k + 1] - prev[k + 1]) * damping;
      const vz = (pos[k + 2] - prev[k + 2]) * damping;
      prev[k] = pos[k];
      prev[k + 1] = pos[k + 1];
      prev[k + 2] = pos[k + 2];
      pos[k] += vx;
      pos[k + 1] += vy + gravity;
      pos[k + 2] += vz;
    }

    for (let it = 0; it < params.iterations; it++) {
      for (let q = 0; q < this.springCount; q++) {
        const a = this.springA[q] * 3;
        const b = this.springB[q] * 3;
        const dx = pos[b] - pos[a];
        const dy = pos[b + 1] - pos[a + 1];
        const dz = pos[b + 2] - pos[a + 2];
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const rest = this.restLength[q];
        const correction = ((length - rest) / length) * this.stiffness(this.springType[q], length < rest, params) * 0.5;
        pos[a] += dx * correction;
        pos[a + 1] += dy * correction;
        pos[a + 2] += dz * correction;
        pos[b] -= dx * correction;
        pos[b + 1] -= dy * correction;
        pos[b + 2] -= dz * correction;
      }

      for (let i = 0; i < n; i++) {
        const k = i * 3;
        let contact = pushOutOfSolid(solid, pos, k, CONTACT_MARGIN);
        if (pos[k + 1] < CONTACT_MARGIN) {
          pos[k + 1] = CONTACT_MARGIN;
          contact = true;
        }
        if (contact) {
          prev[k] += (pos[k] - prev[k]) * params.friction;
          prev[k + 1] += (pos[k + 1] - prev[k + 1]) * params.friction;
          prev[k + 2] += (pos[k + 2] - prev[k + 2]) * params.friction;
        }
      }
    }

    let accumulatedMovement = 0;
    for (let k = 0; k < n * 3; k += 3) {
      accumulatedMovement += Math.hypot(pos[k] - prev[k], pos[k + 1] - prev[k + 1], pos[k + 2] - prev[k + 2]);
    }
    this.accumulatedMovement = accumulatedMovement;
  }

  isBelowSpeed(speedLimit: number, dt: number) {
    const maxDisplacementSquared = (speedLimit * dt) ** 2;
    for (let k = 0; k < this.nodeCount * 3; k += 3) {
      const dx = this.positions[k] - this.previous[k];
      const dy = this.positions[k + 1] - this.previous[k + 1];
      const dz = this.positions[k + 2] - this.previous[k + 2];
      if (dx * dx + dy * dy + dz * dz > maxDisplacementSquared) return false;
    }
    return true;
  }

  updateGeometry() {
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  dispose() {
    this.geometry.dispose();
    this.springGeometry.dispose();
  }

  private stiffness(type: number, compressed: boolean, params: ClothStepParams) {
    switch (type) {
      case SpringType.BEND:
        return compressed ? params.bend : params.bend * 0.25;
      case SpringType.SHEAR:
        return params.stretch * 0.8;
      default:
        return params.stretch;
    }
  }
}
