import * as THREE from "three";

// horizontal sections: faceless head, neck, shoulders, and upper chest
// each section: [height, horizontal radius, depth radius, depth offset]
const SECTIONS = [
  [0, 1.66, 0.7, 0],
  [0.08, 1.76, 0.76, 0],
  [0.24, 1.79, 0.78, 0],
  [0.5, 1.72, 0.75, 0],
  [0.73, 1.52, 0.67, 0],
  [0.94, 1.22, 0.56, 0],
  [1.12, 0.91, 0.47, -0.01],
  [1.3, 0.64, 0.4, -0.025],
  [1.48, 0.47, 0.36, -0.04],
  [1.68, 0.43, 0.35, -0.04],
  [1.94, 0.43, 0.36, -0.015],
  [2.08, 0.47, 0.4, 0.045],
  [2.22, 0.55, 0.46, 0.085],
  [2.48, 0.66, 0.56, 0.09],
  [2.82, 0.73, 0.63, 0.07],
  [3.15, 0.73, 0.65, 0.04],
  [3.48, 0.65, 0.6, 0.015],
  [3.75, 0.46, 0.44, 0],
  [3.91, 0.21, 0.205, 0],
  [3.96, 0, 0, 0],
];

export const HUMAN_BUST_HEIGHT = SECTIONS[SECTIONS.length - 1][0];

// keep the silhouette smooth
const SLOPES = SECTIONS.map((section, index) => [
  0,
  ...[1, 2, 3].map((axis) => {
    if (index === 0) return (SECTIONS[1][axis] - section[axis]) / (SECTIONS[1][0] - section[0]);
    if (index === SECTIONS.length - 1) {
      const previous = SECTIONS[index - 1];
      return (section[axis] - previous[axis]) / (section[0] - previous[0]);
    }
    const previous = SECTIONS[index - 1];
    const next = SECTIONS[index + 1];
    const before = section[0] - previous[0];
    const after = next[0] - section[0];
    const left = (section[axis] - previous[axis]) / before;
    const right = (next[axis] - section[axis]) / after;
    if (left * right <= 0) return 0;
    const w1 = 2 * after + before;
    const w2 = after + 2 * before;
    return (w1 + w2) / (w1 / left + w2 / right);
  }),
]);

type SectionSample = {
  values: number[];
  slopes: number[];
};
const profile: SectionSample = { values: [0, 0, 0], slopes: [0, 0, 0] };

const sampleProfile = (height: number) => {
  const y = THREE.MathUtils.clamp(height, 0, HUMAN_BUST_HEIGHT);
  let low = 0;
  let high = SECTIONS.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (SECTIONS[middle][0] <= y) low = middle;
    else high = middle;
  }
  const from = SECTIONS[low];
  const to = SECTIONS[high];
  const span = to[0] - from[0];
  const t = (y - from[0]) / span;
  const t2 = t * t;
  const t3 = t2 * t;
  for (let axis = 0; axis < 3; axis++) {
    const a = from[axis + 1];
    const b = to[axis + 1];
    const ma = SLOPES[low][axis + 1];
    const mb = SLOPES[high][axis + 1];
    profile.values[axis] =
      (2 * t3 - 3 * t2 + 1) * a +
      (t3 - 2 * t2 + t) * span * ma +
      (-2 * t3 + 3 * t2) * b +
      (t3 - t2) * span * mb;
    profile.slopes[axis] =
      (6 * t2 - 6 * t) * (a - b) / span + (3 * t2 - 4 * t + 1) * ma + (3 * t2 - 2 * t) * mb;
  }
  return profile;
};

const collision = { distance: 0, nx: 0, ny: 0, nz: 1 };

const sampleCollision = (x: number, y: number, z: number) => {
  if (y >= HUMAN_BUST_HEIGHT) {
    const dy = y - HUMAN_BUST_HEIGHT;
    const distance = Math.hypot(x, dy, z);
    collision.distance = distance;
    collision.nx = distance > 1e-8 ? x / distance : 0;
    collision.ny = distance > 1e-8 ? dy / distance : 1;
    collision.nz = distance > 1e-8 ? z / distance : 0;
    return collision;
  }
  const { values, slopes } = sampleProfile(y);
  const rx = Math.max(values[0], 1e-6);
  const rz = Math.max(values[1], 1e-6);
  const dz = z - values[2];
  const radius = Math.hypot(x / rx, dz / rz);
  let nx = 0;
  let ny = 0;
  let nz = 1;
  let distance = -Math.min(rx, rz);
  if (radius > 1e-8) {
    nx = x / (rx * rx * radius);
    nz = dz / (rz * rz * radius);
    ny =
      -(x * x * slopes[0] / rx ** 3 + dz * dz * slopes[1] / rz ** 3 + dz * slopes[2] / (rz * rz)) / radius;
    const gradient = Math.hypot(nx, ny, nz);
    distance = (radius - 1) / gradient;
    nx /= gradient;
    ny /= gradient;
    nz /= gradient;
  }
  if (-y > distance) {
    distance = -y;
    nx = 0;
    ny = -1;
    nz = 0;
  } else if (y - HUMAN_BUST_HEIGHT > distance) {
    distance = y - HUMAN_BUST_HEIGHT;
    nx = 0;
    ny = 1;
    nz = 0;
  }
  collision.distance = distance;
  collision.nx = nx;
  collision.ny = ny;
  collision.nz = nz;
  return collision;
};

export const humanBustDistance = (x: number, y: number, z: number) => sampleCollision(x, y, z).distance;

export const projectOutOfHumanBust = (positions: Float32Array, offset: number, margin: number) => {
  let contact = false;
  // a few newton corrections
  // to preserve the contact margin on sloping shoulders
  for (let iteration = 0; iteration < 6; iteration++) {
    const sample = sampleCollision(positions[offset], positions[offset + 1], positions[offset + 2]);
    if (sample.distance >= margin - 1e-6) break;
    const correction = (margin - sample.distance) * 1.01;
    positions[offset] += sample.nx * correction;
    positions[offset + 1] += sample.ny * correction;
    positions[offset + 2] += sample.nz * correction;
    contact = true;
  }
  return contact;
};

export const createHumanBust = (material: THREE.Material) => {
  const rings = 192;
  const segments = 96;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let ring = 0; ring <= rings; ring++) {
    const y = ring / rings * HUMAN_BUST_HEIGHT;
    const {
      values: [rx, rz, cz],
      slopes: [dx, dz, dc],
    } = sampleProfile(y);
    for (let segment = 0; segment <= segments; segment++) {
      const angle = segment / segments * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      positions.push(rx * cos, y, cz + rz * sin);
      const normal = ring === rings
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(rz * cos, -dx * rz * cos * cos - rx * sin * (dc + dz * sin), rx * sin).normalize();
      normals.push(normal.x, normal.y, normal.z);
      if (ring < rings && segment < segments) {
        const a = ring * (segments + 1) + segment;
        const b = a + segments + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  const baseCenter = positions.length / 3;
  positions.push(0, 0, 0);
  normals.push(0, -1, 0);
  for (let segment = 0; segment <= segments; segment++) {
    positions.push(positions[segment * 3], 0, positions[segment * 3 + 2]);
    normals.push(0, -1, 0);
    if (segment < segments) indices.push(baseCenter, baseCenter + segment + 1, baseCenter + segment + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const bust = new THREE.Mesh(geometry, material);
  bust.name = "androgynous-human-bust";
  return bust;
};
