import type { FabricLayout } from "@/simulate/simulate.types";

export const drawFabricSwatch = (
  canvas: HTMLCanvasElement,
  layout: FabricLayout,
  texture: HTMLCanvasElement,
  tileCells: number,
) => {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const ctx = canvas.getContext("2d");
  if (!width || !height || !ctx) return;

  const dpr = Math.min(window.devicePixelRatio, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const rowLengths = layout.rowLengths;
  const rowCount = rowLengths.length;
  const maxRow = Math.max(...rowLengths);
  const cell = Math.min(width / (maxRow + 1), height / (rowCount + 1));
  const originX = (width - maxRow * cell) / 2;
  const originY = (height - rowCount * cell) / 2;
  const rowTop = (r: number) => originY + (rowCount - 1 - r) * cell;
  const rowOffset = (r: number) => (maxRow - rowLengths[r]) / 2;

  ctx.save();
  ctx.beginPath();
  for (let r = 0; r < rowCount; r++) {
    ctx.rect(originX + rowOffset(r) * cell, rowTop(r), rowLengths[r] * cell, cell + 0.5);
  }
  ctx.clip();
  const tile = tileCells * cell;
  for (let y = originY - tile; y < height + tile; y += tile) {
    for (let x = originX - tile; x < width + tile; x += tile) ctx.drawImage(texture, x, y, tile, tile);
  }
  ctx.restore();
};
