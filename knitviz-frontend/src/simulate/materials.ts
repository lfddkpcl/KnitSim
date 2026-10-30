import type { FabricMaterial, FabricMaterialKey } from "@/simulate/simulate.types";

export const FABRIC_MATERIALS: Record<FabricMaterialKey, FabricMaterial> = {
  wool: {
    weight: 1.0,
    resolution: 1.0,
    stretch: 0.55,
    bend: 0.75,
    friction: 0.75,
    drag: 0.002,
    damping: 0.985,
    iterations: 5,
    roughness: 1.0,
    metalness: 0,
    envMapIntensity: 0.1,
    opacity: 1,
    structure: "knit",
    bumpScale: 0.05,
    baseColor: "#9ec5ff",
  },
  silk: {
    weight: 0.55,
    resolution: 0.45,
    stretch: 1.0,
    bend: 0.02,
    friction: 0.1,
    drag: 0.018,
    damping: 0.998,
    iterations: 10,
    roughness: 0.18,
    metalness: 0.15,
    envMapIntensity: 1.4,
    opacity: 1,
    structure: "smooth",
    bumpScale: 0,
    baseColor: "#9ec5ff",
  },
};

export const PATTERN_COLORS = {
  ground: "#9ec5ff",
  pattern: "#315a8a",
} as const;

export const TEXTURE_TILE_SIZE = 2.6;
