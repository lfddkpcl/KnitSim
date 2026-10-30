<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import Btn from "@/components/ui/Btn.vue";
import { ObjectViewer } from "@/simulate/objectViewer";
import { SOLIDS } from "@/simulate/solids";

const objectCanvasRef = ref<HTMLCanvasElement | null>(null);
const objectViewerError = ref<string | null>(null);
const isHumanSelected = ref(false);

let objectViewer: ObjectViewer | null = null;
let resizeObserver: ResizeObserver | null = null;

const selectHuman = () => {
  isHumanSelected.value = true;
  if (objectViewer) return;
  const canvas = objectCanvasRef.value;
  if (!canvas) return;

  let viewer: ObjectViewer | null = null;
  try {
    viewer = new ObjectViewer(canvas);
    viewer.show("human");
    objectViewer = viewer;
    objectViewerError.value = null;
  } catch (error) {
    viewer?.dispose();
    objectViewer = null;
    console.error("Failed to initialize object preview:", error);
    objectViewerError.value = "Object preview is unavailable because WebGL could not be initialized.";
  }
};

onMounted(() => {
  const canvas = objectCanvasRef.value;
  if (!canvas) return;
  resizeObserver = new ResizeObserver(() => {
    objectViewer?.resize();
    objectViewer?.frame();
  });
  resizeObserver.observe(canvas);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  objectViewer?.dispose();
  objectViewer = null;
});
</script>

<template>
  <section class="simulate-editor">
    <div class="sample-bar">
      <span>Object Sample</span>
      <Btn
        toggleable
        btn_width="12rem"
        btn_height="2.2rem"
        :model-value="isHumanSelected"
        @click="selectHuman"
      >
        {{ SOLIDS.human.label }}
      </Btn>
    </div>

    <div class="simulate-viewer">
      <div class="viewer-stage">
        <canvas ref="objectCanvasRef" class="viewer-canvas"></canvas>
        <div v-if="objectViewerError" class="viewer-empty">{{ objectViewerError }}</div>
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

.simulate-viewer {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  min-height: 0;
}

.viewer-stage {
  position: relative;
  flex: 1 1 0;
  min-height: 170px;
  border: var(--border-container);
  border-radius: var(--border-container-radius);
  overflow: hidden;
  background: #f9fcfb;
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
  background: #f9fcfb;
}
</style>
