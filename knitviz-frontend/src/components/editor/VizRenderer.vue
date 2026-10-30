<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from "vue";
import * as THREE from "three";
import type { VizStatus } from "@/components/editor/editor.types";
import { snapshotToGraph, type GraphSnapshot } from "@/knitgraph/snapshot";
import { PatternViz3D } from "@/knitgraph/3d/viz";
import { FabricSimulation } from "@/simulate/fabricSimulation";
import { useSimulateStore } from "@/stores/simulateStore";
import { PreviewOrbit } from "@/three/previewOrbit";
import { applyPreviewEnvironment, createPreviewFloor } from "@/three/previewFloor";
import type { VizRendererStage } from "@/three/vizRendererStage";

const initialStatus: VizStatus = {
  isLoading: false,
  isReady: false,
  isRunning: false,
  isCancelling: false,
  isSimulationStopping: false,
  isDropResettable: false,
  step: 0,
  accDelta: 0,
  nodes: 0,
  springs: 0,
};

const CANCEL_TIMEOUT_MS = 800;

const props = defineProps<{
  isSimulateMode: boolean;
}>();

const emit = defineEmits<{
  (e: "status", payload: VizStatus): void;
  (e: "viz-ready", payload: PatternViz3D): void;
  (e: "error", payload: string): void;
}>();

const toErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.length > 0) {
    return error;
  }

  return fallback;
};

const emitError = (context: string, error: unknown) => {
  const reason = toErrorMessage(error, "Unknown error");
  emit("error", `${context}: ${reason}`);
};

const containerRef = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);

const hostId = `pattern_viz_${Math.random().toString(36).slice(2, 9)}`;
const resizeObserver = ref<ResizeObserver | null>(null);
const isMounted = ref(false);
const viz = shallowRef<PatternViz3D | null>(null);
const cancelTimeoutId = ref<number | null>(null);
const simulationFrameId = ref<number | null>(null);
const simulationRunning = ref(false);
const simulationStepCount = ref(0);

const simulateStore = useSimulateStore();
let fabricSimulation: FabricSimulation | null = null;
let sharedStage: VizRendererStage | null = null;
const isCanvasVisible = ref(false);

const runId = ref(0);
const currentRunSnapshot = shallowRef<GraphSnapshot | null>(null);
const pendingSnapshot = shallowRef<GraphSnapshot | null>(null);

const status = reactive<VizStatus>({ ...initialStatus });

const stopSimulationLoop = () => {
  simulationRunning.value = false;
  if (simulationFrameId.value !== null) {
    window.cancelAnimationFrame(simulationFrameId.value);
    simulationFrameId.value = null;
  }
};

const cloneInitialStatus = (): VizStatus => ({ ...initialStatus });

const setCanvasVisible = (isVisible: boolean) => {
  isCanvasVisible.value = isVisible;
  if (isVisible) {
    void nextTick(() => sharedStage?.render());
  }
};

const emitStatus = () => {
  emit("status", { ...status });
};

const createSharedStage = (): VizRendererStage | null => {
  const canvas = canvasRef.value;
  const host = canvas?.parentElement;
  if (!canvas || !host) return null;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearAlpha(0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1500);
  camera.position.set(0, 8, -22);
  const floor = createPreviewFloor();
  scene.add(floor.group);
  applyPreviewEnvironment(scene, 22);

  scene.add(new THREE.AmbientLight(0xffffff, 0.42));
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb0bcc4, 0.9));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.35);
  keyLight.position.set(-12, 24, -18);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  Object.assign(keyLight.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 100 });
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xdfe8ff, 0.55);
  fillLight.position.set(18, 12, 16);
  scene.add(fillLight);

  let orbitRef: PreviewOrbit | null = null;
  const controls = new PreviewOrbit(camera, canvas, {
    target: new THREE.Vector3(0, 3, 0),
    minDistance: 1,
    maxDistance: 650,
    onChange: () => {
      if (orbitRef) {
        applyPreviewEnvironment(scene, camera.position.distanceTo(orbitRef.target));
      }
      renderer.render(scene, camera);
    },
  });
  orbitRef = controls;

  const stage: VizRendererStage = {
    canvas,
    renderer,
    scene,
    camera,
    controls,
    floor,
    resize() {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    },
    render() {
      renderer.render(scene, camera);
    },
    frame(bounds, options = {}) {
      controls.frame(bounds, options);
      this.setViewDistance(camera.position.distanceTo(controls.target));
      renderer.render(scene, camera);
    },
    setFloorPosition(x, y, z) {
      floor.group.position.set(x, y, z);
    },
    setViewDistance(distance) {
      applyPreviewEnvironment(scene, distance);
    },
  };
  stage.resize();
  return stage;
};

const disposeSharedStage = () => {
  if (!sharedStage) return;
  sharedStage.controls.dispose();
  sharedStage.scene.remove(sharedStage.floor.group);
  sharedStage.floor.dispose();
  sharedStage.scene.clear();
  sharedStage.renderer.setAnimationLoop(null);
  sharedStage.renderer.dispose();
  sharedStage = null;
};

onMounted(() => {
  isMounted.value = true;

  if (!containerRef.value) {
    return;
  }

  sharedStage = createSharedStage();
  if (!sharedStage) {
    emitError("Preview failed", "VizRenderer could not create its shared 3D stage");
    return;
  }

  resizeObserver.value = new ResizeObserver(() => {
    sharedStage?.resize();
  });

  resizeObserver.value.observe(containerRef.value);
  emitStatus();

  if (props.isSimulateMode) {
    setSimulateMode(true);
  }

  if (pendingSnapshot.value) {
    const queued = pendingSnapshot.value;
    pendingSnapshot.value = null;
    startRun(queued);
  }
});

const startRun = (snapshot: GraphSnapshot) => {
  if (props.isSimulateMode) {
    return;
  }

  if (snapshot.nodes.length === 0) {
    setCanvasVisible(false);
    setStatus(cloneInitialStatus());
    return;
  }

  if (!isMounted.value) {
    pendingSnapshot.value = cloneSnapshot(snapshot);
    return;
  }

  runId.value += 1;
  const currentRunId = runId.value;
  currentRunSnapshot.value = cloneSnapshot(snapshot);
  setCanvasVisible(true);
  if (viz.value) {
    viz.value.dispose();
    viz.value = null;
  }

  setStatusLoading();

  const currentSnapshot = currentRunSnapshot.value;
  if (!currentSnapshot) {
    setStatus(cloneInitialStatus());
    return;
  }
  void createRendererWithoutWorker(currentSnapshot).then((isRendererReady) => {
    if (runId.value !== currentRunId || props.isSimulateMode) {
      return;
    }
    if (!isRendererReady) {
      setCanvasVisible(false);
      setStatus(cloneInitialStatus());
      return;
    }
    setStatusReady();
  }).catch((error) => {
    if (runId.value !== currentRunId || props.isSimulateMode) {
      return;
    }
    console.error("Failed to create renderer:", error);
    setCanvasVisible(false);
    emitError("Render failed", error);
    setStatus(cloneInitialStatus());
  });
};

const cancelRun = () => {
  if (!status.isLoading && !status.isReady) {
    return;
  }
  runId.value += 1;
  clearCancelTimeout();
  setStatus({
    isCancelling: true,
    isSimulationStopping: false,
  });
  clearRunState();
};

const toggleRun = (snapshot: GraphSnapshot) => {
  if (status.isLoading || status.isReady) {
    cancelRun();
    return;
  }

  startRun(snapshot);
};

// Main-thread simulation logic (implement as needed)
const startSimulation = (timeStep: number) => {
  if (!status.isReady || !viz.value || simulationRunning.value) {
    return;
  }

  stopSimulationLoop();

  const normalizedTimeStepMs = Number.isFinite(timeStep) && timeStep > 0 ? timeStep : 100;
  const physicsDelta = 0.1;
  let lastStepAt = performance.now();
  simulationRunning.value = true;
  simulationStepCount.value = status.step;

  setStatus({
    isRunning: true,
    isSimulationStopping: false,
  });

  const tick = (now: number) => {
    if (!viz.value || !simulationRunning.value) {
      stopSimulationLoop();
      setStatus({
        isRunning: false,
        isSimulationStopping: false,
      });
      return;
    }

    const elapsed = now - lastStepAt;
    if (elapsed >= normalizedTimeStepMs) {
      lastStepAt = now;
      try {
        const accDeltaRaw = viz.value.stepSim(physicsDelta);
        if (typeof accDeltaRaw !== "number" || !Number.isFinite(accDeltaRaw)) {
          throw new Error("Simulation produced an invalid physics state.");
        }
        simulationStepCount.value += 1;
        setStatus({
          isRunning: true,
          step: simulationStepCount.value,
          accDelta: accDeltaRaw,
        });
      } catch (error) {
        console.error("Simulation step failed:", error);
        emitError("Simulation failed", error);
        stopSimulationLoop();
        setStatus({
          isRunning: false,
          isSimulationStopping: false,
        });
        return;
      }
    }

    simulationFrameId.value = window.requestAnimationFrame(tick);
  };

  simulationFrameId.value = window.requestAnimationFrame(tick);
};

const stopSimulation = () => {
  if (!status.isReady || !simulationRunning.value) {
    return;
  }
  stopSimulationLoop();
  setStatus({
    isRunning: false,
    isSimulationStopping: false,
  });
};

const toggleSimulation = (timeStep: number) => {
  if (props.isSimulateMode) {
    ensureFabricSimulation()?.toggleSimulation();
    return;
  }
  if (status.isRunning) {
    stopSimulation();
    return;
  }
  startSimulation(timeStep);
};

const clearCancelTimeout = () => {
  if (cancelTimeoutId.value === null) {
    return;
  }

  window.clearTimeout(cancelTimeoutId.value);
  cancelTimeoutId.value = null;
};

const setStatus = (patch: Partial<VizStatus>) => {
  Object.assign(status, patch);
  emitStatus();
};

const setStatusLoading = () => {
  clearCancelTimeout();
  setStatus({
    ...cloneInitialStatus(),
    isLoading: true,
  });
};

const setStatusReady = () => {
  clearCancelTimeout();
  setStatus({
    ...cloneInitialStatus(),
    isReady: true,
  });
};

const cloneSnapshot = (snapshot: GraphSnapshot) => {
  return JSON.parse(JSON.stringify(snapshot)) as GraphSnapshot;
};

const clearRunState = (clearSnapshot = true) => {
  clearCancelTimeout();
  stopSimulationLoop();
  if (viz.value) {
    viz.value.dispose();
    viz.value = null;
  }
  setCanvasVisible(false);

  if (clearSnapshot) {
    currentRunSnapshot.value = null;
  }

  setStatus(cloneInitialStatus());
};

const isHostReady = () => {
  const host = document.getElementById(hostId);
  if (!host) {
    return false;
  }

  const bounds = host.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0;
};

const waitForHostToStart = async () => {
  for (let i = 0; i < 8; i += 1) {
    if (isHostReady()) {
      return true;
    }

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }

  return false;
};

const createRendererWithoutWorker = async (snapshot: GraphSnapshot) => {
  if (!(await waitForHostToStart()) || props.isSimulateMode || !canvasRef.value || !sharedStage) {
    return false;
  }

  if (viz.value) {
    viz.value.dispose();
    viz.value = null;
  }
  const graph = snapshotToGraph(snapshot);
  const nextViz = new PatternViz3D(`#${hostId}`, graph, {
    stage: sharedStage,
  });
  nextViz.resize();
  viz.value = nextViz;
  emit("viz-ready", nextViz);
  return true;
};

const ensureFabricSimulation = () => {
  if (!fabricSimulation && sharedStage) {
    fabricSimulation = new FabricSimulation(sharedStage, simulateStore.settings, {
      onStatus: (nextStatus) => setStatus({ ...cloneInitialStatus(), ...nextStatus }),
      onError: (message) => emit("error", message),
      onVisibilityChange: setCanvasVisible,
    });
  }
  return fabricSimulation;
};

const setSimulateMode = (isSimulateMode: boolean) => {
  stopSimulationLoop();
  setCanvasVisible(false);
  setStatus(cloneInitialStatus());

  if (isSimulateMode) {
    runId.value += 1;
    if (viz.value) {
      viz.value.dispose();
      viz.value = null;
    }
    ensureFabricSimulation()?.activate();
    return;
  }

  fabricSimulation?.deactivate();
};

const generateFabric = () => {
  ensureFabricSimulation()?.generate();
};

const togglePreview = () => {
  ensureFabricSimulation()?.togglePreview();
};

watch(
  () => props.isSimulateMode,
  (isSimulateMode) => {
    setSimulateMode(isSimulateMode);
  },
  { flush: "post" },
);

onBeforeUnmount(() => {
  isMounted.value = false;
  if (resizeObserver.value) {
    resizeObserver.value.disconnect();
    resizeObserver.value = null;
  }
  clearCancelTimeout();
  stopSimulationLoop();
  fabricSimulation?.dispose();
  fabricSimulation = null;
  cancelRun();
  disposeSharedStage();
});

defineExpose({
  startRun,
  cancelRun,
  toggleRun,
  startSimulation,
  stopSimulation,
  toggleSimulation,
  generateFabric,
  togglePreview,
  // No direct expose for dispose/resize; use viz.value methods if needed
  getStatus: () => status,
  getViz: () => viz.value,
});
</script>

<template>
  <div class="viz-renderer" ref="containerRef">
    <div :id="hostId" class="viz-host">
      <canvas ref="canvasRef" class="shared-viz-canvas" :class="{ hidden: !isCanvasVisible }"></canvas>
    </div>
    <div class="viz-loading" v-if="status.isLoading || status.isCancelling">
      <div class="spinner"></div>
      <span>{{ status.isCancelling ? "Cancelling..." : "Preparing graph..." }}</span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.viz-renderer {
  position: relative;
  width: 100%;
  flex: 1;
  min-height: 300px;
  display: flex;
  flex-direction: column;
  border: var(--border-container);
  padding-right: 1px;
  overflow: hidden;
}

.viz-host {
  position: relative;
  flex: 1;
  width: 100%;
  min-height: 0;
}

.shared-viz-canvas {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--color-background-soft);
}

.hidden {
  display: none !important;
}

:deep(.threed_graph) {
  width: 100%;
  height: 100%;
}

:deep(.threed_graph canvas) {
  display: block;
  width: 100%;
  height: 100%;
}

.viz-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  background: var(--color-background-soft);
  z-index: 5;
}

.spinner {
  width: 1.5rem;
  height: 1.5rem;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-heading);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
