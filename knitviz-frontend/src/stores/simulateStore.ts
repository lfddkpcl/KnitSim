import { reactive } from "vue";
import { defineStore } from "pinia";
import { FABRIC_MATERIALS, PATTERN_COLORS } from "@/simulate/materials";
import type { FabricMaterialKey, FabricPrint, SimulateSettings } from "@/simulate/simulate.types";

const createDefaultSettings = (): SimulateSettings => {
  const wool = FABRIC_MATERIALS.wool;
  return {
    shape: "square",
    width: 30,
    length: 30,
    meshSize: 0.24,
    material: "wool",
    stretch: wool.stretch,
    bend: wool.bend,
    friction: wool.friction,
    print: "solid",
    groundColor: wool.baseColor,
    patternColor: PATTERN_COLORS.pattern,
    patternScale: 1,
    solid: "human",
  };
};

export const useSimulateStore = defineStore("simulate", () => {
  const settings = reactive<SimulateSettings>(createDefaultSettings());

  const selectMaterial = (key: FabricMaterialKey) => {
    const material = FABRIC_MATERIALS[key];
    settings.material = key;
    settings.stretch = material.stretch;
    settings.bend = material.bend;
    settings.friction = material.friction;
    if (settings.print === "solid") {
      settings.groundColor = material.baseColor;
    }
  };

  const selectPrint = (print: FabricPrint) => {
    settings.print = print;
    settings.groundColor = PATTERN_COLORS.ground;
    settings.patternColor = PATTERN_COLORS.pattern;
  };

  return {
    settings,
    selectMaterial,
    selectPrint,
  };
});
