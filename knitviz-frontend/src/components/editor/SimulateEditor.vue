<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Btn from "@/components/ui/Btn.vue";
import { createFabricLayoutFromSettings, getCellsPerTextureTile, getTextureTileSize } from "@/simulate/fabricLayout";
import { FabricTextureComposer } from "@/simulate/fabricTexture";
import { drawFabricSwatch } from "@/simulate/fabricSwatch";
import { ObjectViewer } from "@/simulate/objectViewer";
import { SOLIDS } from "@/simulate/solids";
import { useSimulateStore } from "@/stores/simulateStore";
import type {
  FabricMaterialKey,
  FabricPrint,
  FabricShape,
  SimulateSettings,
  SolidKey,
} from "@/simulate/simulate.types";

type SimulateMode = "fabric" | "object";
type FabricTab = "shape" | "material" | "pattern";
type Option<T> = { value: T; label: string };
type NumericSetting = {
  [K in keyof SimulateSettings]: SimulateSettings[K] extends number ? K : never;
}[keyof SimulateSettings];
type Slider = { key: NumericSetting; label: string; min: number; max: number; step: number; digits: number };

const MODE_OPTIONS: Option<SimulateMode>[] = [
  { value: "fabric", label: "Fabric" },
  { value: "object", label: "Object" },
];
const FABRIC_TABS: Option<FabricTab>[] = [
  { value: "shape", label: "Shape" },
  { value: "material", label: "Material" },
  { value: "pattern", label: "Pattern" },
];
const SHAPE_OPTIONS: Option<FabricShape>[] = [
  { value: "square", label: "Square" },
  { value: "circle", label: "Circle" },
];
const MATERIAL_OPTIONS: Option<FabricMaterialKey>[] = [
  { value: "wool", label: "Wool" },
  { value: "silk", label: "Silk" },
];
const PRINT_OPTIONS: Option<FabricPrint>[] = [
  { value: "solid", label: "Solid" },
  { value: "stripes", label: "Striped" },
  { value: "dots", label: "Polka-dotted" },
];
const SOLID_OPTIONS: Option<SolidKey>[] = (Object.keys(SOLIDS) as SolidKey[]).map((key) => ({
  value: key,
  label: SOLIDS[key].label,
}));

const SHAPE_SLIDERS: Slider[] = [
  { key: "width", label: "Width", min: 8, max: 64, step: 1, digits: 0 },
  { key: "length", label: "Length", min: 8, max: 64, step: 1, digits: 0 },
  { key: "meshSize", label: "Mesh size", min: 0.12, max: 0.5, step: 0.02, digits: 2 },
];
const PATTERN_SLIDERS: Slider[] = [
  { key: "patternScale", label: "Pattern scale", min: 0.5, max: 3, step: 0.1, digits: 1 },
];

const store = useSimulateStore();
const settings = store.settings;

const mode = ref<SimulateMode>("fabric");
const fabricTab = ref<FabricTab>("shape");
const swatchRef = ref<HTMLCanvasElement | null>(null);
const objectCanvasRef = ref<HTMLCanvasElement | null>(null);
const objectViewerError = ref<string | null>(null);

const textureComposer = new FabricTextureComposer();
let objectViewer: ObjectViewer | null = null;
let resizeObserver: ResizeObserver | null = null;
let swatchFrameId: number | null = null;

const previewLayout = computed(() => createFabricLayoutFromSettings(settings));

const swatchInfo = computed(() => {
  const rowLengths = previewLayout.value.rowLengths;
  const maxRow = Math.max(...rowLengths);
  return [
    `${rowLengths.length} × ${maxRow}`,
    `Stretch ${settings.stretch.toFixed(2)}`,
    `Bend ${settings.bend.toFixed(2)}`,
    `Friction ${settings.friction.toFixed(2)}`,
  ].join(" · ");
});

const drawSwatch = () => {
  const canvas = swatchRef.value;
  if (!canvas) return;
  const layout = previewLayout.value;
  textureComposer.compose({
    print: settings.print,
    groundColor: settings.groundColor,
    patternColor: settings.patternColor,
    material: settings.material,
    cellsPerTile: getCellsPerTextureTile(settings),
  });
  drawFabricSwatch(
    canvas,
    layout,
    textureComposer.compositeCanvas,
    getTextureTileSize(settings) / settings.meshSize,
  );
};

const scheduleSwatch = () => {
  if (swatchFrameId !== null) return;
  swatchFrameId = requestAnimationFrame(() => {
    swatchFrameId = null;
    drawSwatch();
  });
};

watch(
  () => [
    settings.shape,
    settings.width,
    settings.length,
    settings.meshSize,
    settings.material,
    settings.print,
    settings.groundColor,
    settings.patternColor,
    settings.patternScale,
  ],
  scheduleSwatch,
);

watch(
  () => settings.solid,
  (solid) => objectViewer?.show(solid),
);

const initializeObjectViewer = () => {
  const canvas = objectCanvasRef.value;
  if (objectViewer || objectViewerError.value || !canvas) return;

  let viewer: ObjectViewer | null = null;
  try {
    viewer = new ObjectViewer(canvas);
    viewer.show(settings.solid);
    objectViewer = viewer;
  } catch (error) {
    viewer?.dispose();
    console.error("Failed to initialize object preview:", error);
    objectViewerError.value = "Object preview is unavailable because WebGL could not be initialized.";
  }
};

watch(mode, async (nextMode) => {
  await nextTick();
  if (nextMode === "object") {
    initializeObjectViewer();
    objectViewer?.resize();
    objectViewer?.frame();
  } else {
    scheduleSwatch();
  }
});

onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    scheduleSwatch();
    objectViewer?.resize();
  });
  if (swatchRef.value) resizeObserver.observe(swatchRef.value);
  if (objectCanvasRef.value) resizeObserver.observe(objectCanvasRef.value);
  drawSwatch();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  if (swatchFrameId !== null) cancelAnimationFrame(swatchFrameId);
  objectViewer?.dispose();
  objectViewer = null;
});
</script>

<template>
  <section class="simulate-editor">
    <div class="tabs">
      <button
        v-for="option in MODE_OPTIONS"
        :key="option.value"
        class="tab"
        :class="{ active: mode === option.value }"
        @click="mode = option.value"
      >
        {{ option.label }}
      </button>
    </div>

    <div v-show="mode === 'fabric'" class="simulate-controls">
      <div class="tabs">
        <button
          v-for="tab in FABRIC_TABS"
          :key="tab.value"
          class="tab"
          :class="{ active: fabricTab === tab.value }"
          @click="fabricTab = tab.value"
        >
          {{ tab.label }}
        </button>
      </div>

      <div v-show="fabricTab === 'shape'" class="simulate-pane">
        <div class="toolbar">
          <Btn
            v-for="option in SHAPE_OPTIONS"
            :key="option.value"
            toggleable
            btn_width="6rem"
            btn_height="2.2rem"
            :model-value="settings.shape === option.value"
            @click="settings.shape = option.value"
          >
            {{ option.label }}
          </Btn>
        </div>
        <label v-for="slider in SHAPE_SLIDERS" :key="slider.key" class="control-group">
          <span class="slider-label">{{ slider.label }}</span>
          <input
            v-model.number="settings[slider.key]"
            type="range"
            :min="slider.min"
            :max="slider.max"
            :step="slider.step"
          />
          <span class="slider-value">{{ settings[slider.key].toFixed(slider.digits) }}</span>
        </label>
      </div>

      <div v-show="fabricTab === 'material'" class="simulate-pane">
        <div class="toolbar">
          <Btn
            v-for="option in MATERIAL_OPTIONS"
            :key="option.value"
            toggleable
            btn_width="6rem"
            btn_height="2.2rem"
            :model-value="settings.material === option.value"
            @click="store.selectMaterial(option.value)"
          >
            {{ option.label }}
          </Btn>
        </div>
      </div>

      <div v-show="fabricTab === 'pattern'" class="simulate-pane">
        <div class="toolbar">
          <Btn
            v-for="option in PRINT_OPTIONS"
            :key="option.value"
            toggleable
            btn_width="7rem"
            btn_height="2.2rem"
            :model-value="settings.print === option.value"
            @click="store.selectPrint(option.value)"
          >
            {{ option.label }}
          </Btn>
        </div>
        <div class="sample-bar">
          <label class="control-group">
            <span>Ground</span>
            <input v-model="settings.groundColor" type="color" />
          </label>
          <label class="control-group">
            <span>Pattern</span>
            <input v-model="settings.patternColor" type="color" />
          </label>
        </div>
        <label v-for="slider in PATTERN_SLIDERS" :key="slider.key" class="control-group">
          <span class="slider-label">{{ slider.label }}</span>
          <input
            v-model.number="settings[slider.key]"
            type="range"
            :min="slider.min"
            :max="slider.max"
            :step="slider.step"
          />
          <span class="slider-value">{{ settings[slider.key].toFixed(slider.digits) }}</span>
        </label>
      </div>
    </div>

    <div v-show="mode === 'object'" class="simulate-controls">
      <div class="toolbar">
        <Btn
          v-for="option in SOLID_OPTIONS"
          :key="option.value"
          toggleable
          btn_width="6rem"
          btn_height="2.2rem"
          :model-value="settings.solid === option.value"
          @click="settings.solid = option.value"
        >
          {{ option.label }}
        </Btn>
      </div>
    </div>

    <div v-show="mode === 'fabric'" class="simulate-viewer">
      <div class="viewer-caption">
        <span>Fabric Preview</span>
        <span>{{ swatchInfo }}</span>
      </div>
      <div class="viewer-stage">
        <canvas ref="swatchRef" class="viewer-canvas"></canvas>
      </div>
    </div>

    <div v-show="mode === 'object'" class="simulate-viewer">
      <div class="viewer-caption">
        <span>Object Viewer</span>
        <span>{{ SOLIDS[settings.solid].label }}</span>
      </div>
      <div class="viewer-stage">
        <canvas ref="objectCanvasRef" class="viewer-canvas"></canvas>
        <div v-if="objectViewerError" class="viewer-empty">{{ objectViewerError }}</div>
        <div v-else-if="settings.solid === 'none'" class="viewer-empty">No object selected</div>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.simulate-editor {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.simulate-controls,
.simulate-pane {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  gap: 0.55rem;
  min-height: 0;
  overflow: auto;
}

.slider-label {
  min-width: 6.5rem;
}

.control-group input[type="range"] {
  width: 6.5rem;
  accent-color: var(--color-heading);
}

.slider-value {
  min-width: 2.5rem;
  color: var(--color-text-muted);
}

.simulate-viewer {
  display: flex;
  flex: 0 0 46%;
  flex-direction: column;
  min-height: 190px;
  margin-top: auto;
  padding-top: 0.5rem;
  border-top: var(--border-container);
}

.viewer-caption {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.25rem;
  color: var(--color-text-muted);
  font-size: var(--font-size-xsmall);
}

.viewer-stage {
  position: relative;
  flex: 1 1 0;
  min-height: 170px;
  border: var(--border-container);
  background: var(--color-background-mute);
}

.viewer-canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
}

.viewer-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  background: var(--color-background-mute);
}
</style>
