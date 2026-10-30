import * as THREE from "three";
import { FABRIC_MATERIALS } from "@/simulate/materials";
import type { FabricMaterialKey, FabricPrint, FabricStructure } from "@/simulate/simulate.types";

export const TEXTURE_SIZE = 1024;

type Rgb = [number, number, number];
type PrintPainter = (ctx: CanvasRenderingContext2D, size: number, ground: Rgb, pattern: Rgb) => void;
type StructurePainter = (ctx: CanvasRenderingContext2D, size: number, cells: number) => void;

const hexToRgb = (hex: string): Rgb => {
  const color = new THREE.Color(hex);
  return [color.r * 255, color.g * 255, color.b * 255];
};

const rgbToCss = (color: Rgb) => `rgb(${color[0] | 0},${color[1] | 0},${color[2] | 0})`;

const drawWrapped = (ctx: CanvasRenderingContext2D, size: number, x: number, y: number, fn: () => void) => {
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      ctx.save();
      ctx.translate(x + i * size, y + j * size);
      fn();
      ctx.restore();
    }
  }
};

const PRINT_PAINTERS: Record<FabricPrint, PrintPainter> = {
  solid(ctx, size, ground) {
    ctx.fillStyle = rgbToCss(ground);
    ctx.fillRect(0, 0, size, size);
  },
  stripes(ctx, size, ground, pattern) {
    ctx.fillStyle = rgbToCss(ground);
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = rgbToCss(pattern);
    const h = size / 8;
    for (let i = 0; i < 4; i++) ctx.fillRect(0, i * 2 * h + h * 0.35, size, h * 0.6);
  },
  dots(ctx, size, ground, pattern) {
    ctx.fillStyle = rgbToCss(ground);
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = rgbToCss(pattern);
    const pitch = size / 4;
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        const offset = j % 2 ? pitch / 2 : 0;
        drawWrapped(ctx, size, i * pitch + pitch / 2 + offset, j * pitch + pitch / 2, () => {
          ctx.beginPath();
          ctx.arc(0, 0, pitch * 0.24, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }
  },
};

const STRUCTURE_PAINTERS: Record<FabricStructure, StructurePainter> = {
  knit(ctx, size, cells) {
    const w = size / cells;
    const rows = Math.round(size / (w * 0.8));
    const h = size / rows;
    ctx.fillStyle = "#9a9a9a";
    ctx.fillRect(0, 0, size, size);
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cells; c++) {
        const cx = c * w + w / 2;
        const cy = r * h + h / 2;
        for (const side of [-1, 1]) {
          ctx.save();
          ctx.translate(cx + side * w * 0.22, cy);
          ctx.rotate(side * 0.55);
          const gradient = ctx.createLinearGradient(0, -h * 0.5, 0, h * 0.5);
          gradient.addColorStop(0, "#f4f4f4");
          gradient.addColorStop(0.55, "#d0d0d0");
          gradient.addColorStop(1, "#8a8a8a");
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.ellipse(0, 0, w * 0.2, h * 0.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }
  },
  smooth(ctx, size) {
    ctx.fillStyle = "#e9e9e9";
    ctx.fillRect(0, 0, size, size);
  },
};

export type FabricTextureOptions = {
  print: FabricPrint;
  groundColor: string;
  patternColor: string;
  material: FabricMaterialKey;
  cellsPerTile: number;
};

const createCanvas = () => {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  return canvas;
};

const getCanvasContext = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context is unavailable.");
  return ctx;
};

export class FabricTextureComposer {
  readonly compositeCanvas = createCanvas();
  readonly structureCanvas = createCanvas();
  private readonly printCanvas = createCanvas();

  compose(options: FabricTextureOptions) {
    const printCtx = getCanvasContext(this.printCanvas);
    const structureCtx = getCanvasContext(this.structureCanvas);
    const compositeCtx = getCanvasContext(this.compositeCanvas);
    printCtx.setTransform(1, 0, 0, 1, 0, 0);
    structureCtx.setTransform(1, 0, 0, 1, 0, 0);

    PRINT_PAINTERS[options.print](
      printCtx,
      TEXTURE_SIZE,
      hexToRgb(options.groundColor),
      hexToRgb(options.patternColor),
    );
    STRUCTURE_PAINTERS[FABRIC_MATERIALS[options.material].structure](
      structureCtx,
      TEXTURE_SIZE,
      options.cellsPerTile,
    );

    compositeCtx.globalCompositeOperation = "source-over";
    compositeCtx.globalAlpha = 1;
    compositeCtx.drawImage(this.printCanvas, 0, 0);
    compositeCtx.globalCompositeOperation = "multiply";
    compositeCtx.globalAlpha = 0.9;
    compositeCtx.drawImage(this.structureCanvas, 0, 0);
    compositeCtx.globalCompositeOperation = "screen";
    compositeCtx.globalAlpha = 0.18;
    compositeCtx.drawImage(this.structureCanvas, 0, 0);
    compositeCtx.globalCompositeOperation = "source-over";
    compositeCtx.globalAlpha = 1;
  }

  createTextures() {
    const map = new THREE.CanvasTexture(this.compositeCanvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 8;

    const bump = new THREE.CanvasTexture(this.structureCanvas);
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping;

    return { map, bump };
  }
}
