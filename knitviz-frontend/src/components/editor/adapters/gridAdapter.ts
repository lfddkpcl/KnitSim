import type { GlobalEditorState } from "@/stores/globalEditorStore";
import { EditorType } from "@/stores/globalEditorStore";
import { graphToSnapshot, type GraphSnapshot } from "@/knitgraph/snapshot";
import {
  KnitEdge,
  KnitEdgeDirection,
  KnitGraph,
  KnitMode,
  KnitNode,
  KnitNodeType,
  KnitSide,
  YarnSpec,
} from "@/knitgraph";
import type { EditorAdapter } from "@/components/editor/adapters/adapterInterface";
import {
  DEFAULT_GRID_COLS,
  DEFAULT_GRID_COLOR,
  DEFAULT_GRID_ROWS,
  DEFAULT_GRID_STITCH_TYPE,
  MIN_GRID_COLS,
  MIN_GRID_ROWS,
  MAX_GRID_COLS,
  MAX_GRID_ROWS,
} from "@/components/editor/editor.constants";
import type { GridCellState, GridEditorState } from "@/components/editor/editor.types";

const toCssHexColor = (value: number | string): string => {
  if (typeof value === "string") {
    return value;
  }

  const normalized = Math.max(0, Math.min(0xffffff, Math.trunc(value)));
  return `#${normalized.toString(16).padStart(6, "0")}`;
};

const normalizeGridStitchType = (value: string): string => {
  const normalized = value.toUpperCase();
  if (normalized === "PURL" || normalized === "YARN_OVER" || normalized === "DECREASE") {
    return normalized;
  }

  return "KNIT";
};

const toGridStitchType = (nodeType: KnitNodeType): string => {
  if (nodeType === KnitNodeType.PURL) {
    return "PURL";
  }

  if (nodeType === KnitNodeType.YARN_OVER) {
    return "YARN_OVER";
  }

  if (nodeType === KnitNodeType.DECREASE) {
    return "DECREASE";
  }

  return "KNIT";
};

const matrixFromSnapshot = (snapshot: GraphSnapshot): GridCellState[][] => {
  if (snapshot.nodes.length === 0) {
    return toMatrix({
      rows: DEFAULT_GRID_ROWS,
      cols: DEFAULT_GRID_COLS,
      cells: [],
      castOnMode: "round",
      cellSize: 20,
    });
  }

  const byRow = new Map<number, typeof snapshot.nodes>();
  for (const node of snapshot.nodes) {
    const rowNodes = byRow.get(node.rowNumber) ?? [];
    rowNodes.push(node);
    byRow.set(node.rowNumber, rowNodes);
  }

  let sortedRows = [...byRow.keys()].sort((a, b) => a - b);
  if (sortedRows.length > 0) {
    const firstRowNodes = byRow.get(sortedRows[0]) ?? [];
    const isCastOnRow = firstRowNodes.length > 0 && firstRowNodes.every((node) => node.type === KnitNodeType.CAST_ON);
    if (isCastOnRow) {
      sortedRows = sortedRows.slice(1);
    }
  }

  if (sortedRows.length === 0) {
    return toMatrix({
      rows: DEFAULT_GRID_ROWS,
      cols: DEFAULT_GRID_COLS,
      cells: [],
      castOnMode: "round",
      cellSize: 20,
    });
  }

  const allCols = sortedRows.flatMap((rowNumber) => (byRow.get(rowNumber) ?? []).map((node) => node.colNumber));
  const minCol = Math.min(...allCols);
  const maxCol = Math.max(...allCols);
  const cols = Math.max(1, maxCol - minCol + 1);
  const rows = sortedRows.length;
  const matrix = createGrid(rows, cols);

  sortedRows.forEach((rowNumber, normalizedRow) => {
    const rowNodes = byRow.get(rowNumber) ?? [];
    rowNodes.forEach((node) => {
      const normalizedCol = node.colNumber - minCol;
      const cell = matrix[normalizedRow]?.[normalizedCol];
      if (!cell) {
        return;
      }

      cell.type = toGridStitchType(node.type);
      cell.color = toCssHexColor(node.color);
    });
  });

  return matrix;
};

const createCell = (row: number, col: number): GridCellState => ({
  id: `${row}-${col}`,
  row,
  col,
  type: DEFAULT_GRID_STITCH_TYPE,
  color: DEFAULT_GRID_COLOR,
});

const createGrid = (rows: number, cols: number): GridCellState[][] =>
  Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => createCell(row, col)),
  );

const toMatrix = (gridState: GridEditorState): GridCellState[][] => {
  const rows = Math.max(MIN_GRID_ROWS, Math.min(MAX_GRID_ROWS, gridState.rows || DEFAULT_GRID_ROWS));
  const cols = Math.max(MIN_GRID_COLS, Math.min(MAX_GRID_COLS, gridState.cols || DEFAULT_GRID_COLS));
  const matrix = createGrid(rows, cols);

  for (const cell of gridState.cells) {
    if (matrix[cell.row]?.[cell.col]) {
      matrix[cell.row][cell.col] = {
        ...cell,
        id: `${cell.row}-${cell.col}`,
        type: normalizeGridStitchType(cell.type),
      };
    }
  }

  return matrix;
};

const toFlat = (matrix: GridCellState[][]): GridEditorState => ({
  rows: matrix.length,
  cols: matrix[0]?.length || 0,
  cells: matrix.flat().map((cell) => ({
    ...cell,
    type: normalizeGridStitchType(cell.type),
  })),
  castOnMode: "round",
  cellSize: 20,
});

const defaultMatrix = () =>
  toMatrix({
    rows: DEFAULT_GRID_ROWS,
    cols: DEFAULT_GRID_COLS,
    cells: [],
    castOnMode: "round",
    cellSize: 20,
  });

const normalizeStitchType = (value: string): KnitNodeType => {
  const normalized = normalizeGridStitchType(value);

  if (normalized === "PURL") {
    return KnitNodeType.PURL;
  }

  if (normalized === "YARN_OVER") {
    return KnitNodeType.YARN_OVER;
  }

  if (normalized === "DECREASE") {
    return KnitNodeType.DECREASE;
  }

  return KnitNodeType.KNIT;
};

const getGridWidth = (matrix: GridCellState[][]): number => {
  if (matrix.length === 0) {
    return 0;
  }

  return matrix[0].length;
};

const getRowConsumptionCounts = (row: GridCellState[]): number[] =>
  row.map((cell) => {
    const type = normalizeStitchType(cell.type);
    if (type === KnitNodeType.YARN_OVER) {
      return 0;
    }
    if (type === KnitNodeType.DECREASE) {
      return 2;
    }
    return 1;
  });

const validateRows = (matrix: GridCellState[][]): number[][] => {
  let availableStitches = getGridWidth(matrix);
  const rowConsumptionCounts: number[][] = [];

  matrix.forEach((row, rowIndex) => {
    const consumptionCounts = getRowConsumptionCounts(row);
    const consumedStitches = consumptionCounts.reduce((total, count) => total + count, 0);

    if (consumedStitches !== availableStitches) {
      throw new Error(
        `Row ${rowIndex + 1} consumes ${consumedStitches} stitches, but ${availableStitches} are available.`,
      );
    }

    rowConsumptionCounts.push(consumptionCounts);
    availableStitches = row.length;
  });

  return rowConsumptionCounts;
};

const createGridGraph = (matrix: GridCellState[][], castOnMode: "flat" | "round") => {
  const isRound = castOnMode === "round";
  const rowConsumptionCounts = validateRows(matrix);

  KnitNode.idCounter = 0;
  const graph = new KnitGraph();
  const width = getGridWidth(matrix);

  let knitMode: KnitMode = KnitMode.FLAT;
  if (isRound) {
    knitMode = KnitMode.ROUND;
  }
  graph.state.cast_on(width, knitMode);

  let previousRow = Object.values(graph.nodes).sort((a, b) => a.col_number - b.col_number);
  let previousRowEnd = previousRow[previousRow.length - 1];
  let side = graph.state.side;

  matrix.forEach((row, rowIndex) => {
    let availableStitches = [...previousRow].reverse();
    if (isRound) {
      availableStitches = previousRow;
    }
    const currentRow: KnitNode[] = [];
    let consumedStitchIndex = 0;
    let previousNode: KnitNode | undefined;

    row.forEach((cell, colIndex) => {
      const type = normalizeStitchType(cell.type);
      const node = new KnitNode(type, new YarnSpec(cell.color, 1), colIndex === 0, side);
      node.row_number = rowIndex + 1;
      node.col_number = colIndex;
      node.yarn_over = type === KnitNodeType.YARN_OVER;
      node.previous_node = previousRowEnd;
      if (previousNode) {
        node.previous_node = previousNode;
      }
      graph.nodes[node.id] = node;

      const consumedStitchCount = rowConsumptionCounts[rowIndex][colIndex];
      for (let stitchIndex = 0; stitchIndex < consumedStitchCount; stitchIndex++) {
        const consumedStitch = availableStitches[consumedStitchIndex];
        graph.edges.push(new KnitEdge(consumedStitch.id, node.id, KnitEdgeDirection.COLUMN, side));
        consumedStitchIndex++;
      }

      if (previousNode) {
        graph.edges.push(new KnitEdge(previousNode.id, node.id, KnitEdgeDirection.ROW, side));
      }

      currentRow.push(node);
      previousNode = node;
    });

    if (isRound && currentRow.length > 0) {
      graph.edges.push(
        new KnitEdge(
          currentRow[currentRow.length - 1].id,
          currentRow[0].id,
          KnitEdgeDirection.ROW,
          side,
        ),
      );
    }

    previousRow = currentRow;
    previousRowEnd = currentRow[currentRow.length - 1];
    if (!isRound) {
      if (side === KnitSide.RIGHT) {
        side = KnitSide.WRONG;
      } else {
        side = KnitSide.RIGHT;
      }
    }
  });

  return graph;
};

type GridAdapterInput = {
  matrix: GridCellState[][];
  castOnMode: "flat" | "round";
  cellSize: number;
};

type GridToStore = {
  grid: GridEditorState;
  graph: GraphSnapshot;
};

export const gridAdapter: EditorAdapter<GlobalEditorState, { matrix: GridCellState[][]; castOnMode: "flat" | "round"; cellSize: number }, GridAdapterInput, GridToStore> = {
  fromStore(state: GlobalEditorState) {
    const gridState = state.editors.grid;
    const hasStoredCells = gridState.cells.length > 0;

    if (state.sourceEditor !== EditorType.GRID) {
      return {
        matrix: state.graph.nodes.length > 0 ? matrixFromSnapshot(state.graph) : defaultMatrix(),
        castOnMode: gridState.castOnMode,
        cellSize: gridState.cellSize,
      };
    }

    if (hasStoredCells) {
      return {
        matrix: toMatrix(gridState),
        castOnMode: gridState.castOnMode,
        cellSize: gridState.cellSize,
      };
    }

    return {
      matrix: defaultMatrix(),
      castOnMode: gridState.castOnMode,
      cellSize: gridState.cellSize,
    };
  },
  createSnapshot(input: GridAdapterInput) {
    const { matrix, castOnMode } = input;
    return graphToSnapshot(createGridGraph(matrix, castOnMode));
  },
  toStore(input: GridAdapterInput) {
    const snapshot = this.createSnapshot(input);
    const grid = {
      ...toFlat(input.matrix),
      castOnMode: input.castOnMode,
      cellSize: input.cellSize,
    };
    return {
      grid,
      graph: snapshot,
    };
  },
};
