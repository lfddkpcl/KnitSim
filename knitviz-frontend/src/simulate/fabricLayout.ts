import { FABRIC_MATERIALS, TEXTURE_TILE_SIZE } from "@/simulate/materials";
import type { FabricLayout, FabricShape, SimulateSettings } from "@/simulate/simulate.types";

export const MAX_FABRIC_NODES = 6_000;

export const createFabricLayout = (shape: FabricShape, width: number, length: number): FabricLayout => {
  const rowLengths: number[] = [];

  if (shape === "square") {
    for (let r = 0; r < length; r++) rowLengths.push(width);
  } else {
    const radiusX = width / 2;
    const rowCount = Math.max(2, Math.round(length));
    for (let r = 0; r < rowCount; r++) {
      const t = ((r + 0.5) / rowCount) * 2 - 1;
      rowLengths.push(Math.max(2, Math.round(2 * radiusX * Math.sqrt(Math.max(0, 1 - t * t)))));
    }
  }

  return { rowLengths };
};

export const createFabricLayoutFromSettings = (settings: SimulateSettings) => {
  const scale = 1 / FABRIC_MATERIALS[settings.material].resolution;
  return createFabricLayout(settings.shape, Math.round(settings.width * scale), Math.round(settings.length * scale));
};

export const getFabricNodeCount = (layout: FabricLayout) =>
  layout.rowLengths.reduce((sum, rowLength) => sum + rowLength, 0);

export const getStitchWidth = (settings: SimulateSettings) =>
  settings.meshSize * FABRIC_MATERIALS[settings.material].resolution;

export const getTextureTileSize = (settings: SimulateSettings) => TEXTURE_TILE_SIZE * settings.patternScale;

export const getCellsPerTextureTile = (settings: SimulateSettings) =>
  Math.max(4, Math.round(getTextureTileSize(settings) / getStitchWidth(settings)));
