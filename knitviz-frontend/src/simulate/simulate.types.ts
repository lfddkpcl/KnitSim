export type FabricShape = "square" | "circle";
export type FabricMaterialKey = "wool" | "silk";
export type FabricPrint = "solid" | "stripes" | "dots";
export type FabricStructure = "knit" | "smooth";
export type SolidKey = "human";

export type SimulateSettings = {
  shape: FabricShape;
  width: number;
  length: number;
  meshSize: number;
  material: FabricMaterialKey;
  stretch: number;
  bend: number;
  friction: number;
  print: FabricPrint;
  groundColor: string;
  patternColor: string;
  patternScale: number;
  solid: SolidKey;
};

export type FabricLayout = {
  rowLengths: number[];
};

export type FabricMaterial = {
  weight: number;
  resolution: number;
  stretch: number;
  bend: number;
  friction: number;
  drag: number;
  damping: number;
  iterations: number;
  roughness: number;
  metalness: number;
  envMapIntensity: number;
  opacity: number;
  structure: FabricStructure;
  bumpScale: number;
  baseColor: string;
};
