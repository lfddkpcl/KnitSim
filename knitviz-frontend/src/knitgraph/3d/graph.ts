import { toRaw } from "vue";
import { KnitEdge, KnitEdgeDirection, KnitGraph, KnitNodeType } from "..";
import type { GraphConfig, KnitGraphC, KnitSim } from "../sim/knitsim-lib";
import { KnitSimModule } from "./viz";

import * as d3 from "d3";
import * as THREE from "three";
import { KnitNode3D } from "./node";

export class KnitGraph3D extends KnitGraph<KnitNode3D, KnitEdge> {
  graph_wasm: KnitGraphC;
  graph_sim: KnitSim;
  cfg: GraphConfig;
  round: boolean = false;

  constructor(graph: KnitGraph) {
    super();
    for (let key in graph) {
      this[key] = toRaw(graph[key]);
    }

    this.edges = [...graph.edges];
    this.edges = this.edges.map((edge) => toRaw(edge));
    this.nodes = {};
    for (let key in graph.nodes) {
      let node = graph.nodes[key];
      this.nodes[node.id] = new KnitNode3D(toRaw(node), new THREE.Vector3());
    }

    this.assertIntegrity();
    this.detectRound();
    this.markDecreaseMerges();
  }

  private markDecreaseMerges() {
    const columnTargetCount = new Map<number, number>();
    for (const edge of this.edges) {
      if (edge.direction !== KnitEdgeDirection.COLUMN) continue;
      columnTargetCount.set(edge.to, (columnTargetCount.get(edge.to) ?? 0) + 1);
    }
    for (const edge of this.edges) {
      if (edge.direction !== KnitEdgeDirection.COLUMN) continue;
      const fanIn = columnTargetCount.get(edge.to) ?? 1;
      if (fanIn > 1) this.nodes[edge.from].mergeFanIn = fanIn;
    }
  }

  private detectRound() {
    this.round = this.edges.some((edge) => {
      const from = this.nodes[edge.from];
      const to = this.nodes[edge.to];
      return (
        edge.direction === KnitEdgeDirection.ROW &&
        to.start_of_row &&
        from.row_number === to.row_number &&
        from.col_number > to.col_number
      );
    });
  }

  private assertIntegrity() {
    const nodeIds = new Set<number>();
    for (const key in this.nodes) {
      const node = this.nodes[key];
      if (nodeIds.has(node.id)) {
        throw new Error(`Invalid graph: duplicate node id ${node.id}`);
      }
      nodeIds.add(node.id);
    }

    for (const edge of this.edges) {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
        throw new Error(
          `Invalid graph: edge ${edge.from} -> ${edge.to} references missing node(s)`,
        );
      }
    }
  }

  step(time: number) {
    if (!this.graph_wasm) {
      return;
    }
    console.log("Stepping sim", time, this.graph_wasm, this.graph_wasm.isDeleted());
    let accumulated_movement = this.graph_sim.step(time, 0.1, 0.2);
    console.log("Accumulated movement", accumulated_movement);
    if (!Number.isFinite(accumulated_movement)) {
      throw new Error("Simulation produced an invalid physics state.");
    }
    this.graph_wasm.computeKnitPaths(this.cfg.loop_width, true);
    this.syncGraphWASM();
    return accumulated_movement;
  }

  knitPathPoints(node: KnitNode3D) {
    const knitPath = this.graph_wasm.knitPath(node.id);
    return new Array(knitPath.size()).fill(0).map((_, id) => {
      const vec = knitPath.get(id);
      return new THREE.Vector3(vec.x, vec.y, vec.z);
    });
  }

  hasIncreaseAfter(node: KnitNode3D) {
    const currentRow = Object.values(this.nodes).filter(
      (candidate) => candidate.row_number === node.row_number,
    );
    const nextRowNumber = Math.min(
      ...Object.values(this.nodes)
        .map((candidate) => candidate.row_number)
        .filter((rowNumber) => rowNumber > node.row_number),
    );
    if (!Number.isFinite(nextRowNumber)) {
      return false;
    }

    const nextRow = Object.values(this.nodes).filter(
      (candidate) => candidate.row_number === nextRowNumber,
    );
    if (nextRow.length > currentRow.length) {
      return true;
    }

    const currentIds = new Set(currentRow.map((candidate) => candidate.id));
    const nextIds = new Set(nextRow.map((candidate) => candidate.id));
    const columnTargets = new Map<number, number>();
    for (const edge of this.edges) {
      if (
        edge.direction === KnitEdgeDirection.COLUMN &&
        currentIds.has(edge.from) &&
        nextIds.has(edge.to)
      ) {
        columnTargets.set(edge.from, (columnTargets.get(edge.from) ?? 0) + 1);
      }
    }
    return [...columnTargets.values()].some((count) => count > 1);
  }

  syncGraphWASM() {
    if (!this.graph_wasm) {
      return;
    }
    for (let key in this.nodes) {
      let node = this.nodes[key];
      let wasm_node = this.graph_wasm.getNode(node.id);
      node.position.set(wasm_node.position.x, wasm_node.position.y, wasm_node.position.z);
      node.normal.set(wasm_node.normal.x, wasm_node.normal.y, wasm_node.normal.z);

      // update if instanced after computeKnitPath
      node.instanced = wasm_node.instanced;
      node.yarn_over = wasm_node.yarn_over;

      let force = this.graph_sim.force(node.id);
      node.force.set(force.x, force.y, force.z);

      const knitPathPoints = this.knitPathPoints(node);
      if (node.mesh) {
        node.curve.points = knitPathPoints;
        node.yarn_geometry.dispose();
        node.yarn_geometry = new THREE.TubeGeometry(
          node.curve,
          knitPathPoints.length * 4,
          node.yarnSpec.weight * this.cfg.yarn_thickness,
          4,
          true,
        );
        node.mesh.geometry = node.yarn_geometry;
      }
      if (node.node_sphere_mesh) {
        node.node_sphere_mesh.position.set(node.position.x, node.position.y, node.position.z);
        node.node_sphere_mesh.updateMatrix();
      }
      if (node.normal_helper) {
        node.normal_helper.position.set(node.position.x, node.position.y, node.position.z);
        node.normal_helper.setDirection(node.normal);
        node.normal_helper.updateMatrix();
      }
      if (node.force_helper) {
        node.force_helper.position.set(node.position.x, node.position.y, node.position.z);
        node.force_helper.setDirection(node.force);
        node.force_helper.updateMatrix();
      }
      let outgoing = this.outgoing(node);
      for (let i = 0; i < node.outgoing_helpers.length; i++) {
        let helper = node.outgoing_helpers[i];
        let edge = outgoing[i];
        let to = this.nodes[edge.to];
        let dir = to.position.clone().sub(node.position);
        helper.setDirection(dir.clone().normalize());
        helper.setLength(dir.length());
        helper.position.set(node.position.x, node.position.y, node.position.z);
        helper.updateMatrix();
      }
    }
  }
  initGraphWASM(cfg: GraphConfig) {
    this.assertIntegrity();
    this.cfg = cfg;
    let node_vec = new KnitSimModule.NodeVector();
    let edge_vec = new KnitSimModule.EdgeVector();
    for (let key in this.nodes) {
      let node = this.nodes[key];
      if(node.type == KnitNodeType.YARN_OVER) {
        node.yarn_over = true; } // has to be set here, in index.ts it doesn't get saved
      let node_wasm = {
        id: node.id,
        line_number: node.line_number,
        row_number: node.row_number,
        col_number: node.col_number,
        start_of_row: node.start_of_row,
        previous_node_id: node.previous_node?.id ?? node.id,
        type: KnitSimModule.KnitNodeTypeC[`KnitNodeTypeC_${node.type.toUpperCase()}`],
        yarn_over: node.yarn_over,
        mode: KnitSimModule.KnitModeC.KnitModeC_FLAT,
        side: KnitSimModule.KnitSideC[`KnitSideC_${node.side}`],
        position: new KnitSimModule.Vector3f(node.position.x, node.position.y, node.position.z),
        normal: node.normal
          ? new KnitSimModule.Vector3f(node.normal.x, node.normal.y, node.normal.z)
          : new KnitSimModule.Vector3f(0, 0, 0),
        next_dir: new KnitSimModule.Vector3f(0, 0, 0),
        instanced: true
      };
      // console.log("Node wasm", node_wasm)
      node_vec.push_back(node_wasm);
    }

    for (let edge of this.edges) {
      edge_vec.push_back({
        from: edge.from,
        to: edge.to,
        direction: KnitSimModule.KnitEdgeDirectionC[`KnitEdgeDirectionC_${edge.direction}`],
        id: edge_vec.size(),
      });
    }
    let graph = new KnitSimModule.KnitGraphC(cfg, node_vec, edge_vec);
    this.graph_wasm = graph;
    this.graph_sim = new KnitSimModule.KnitSim(graph, {
      f_expansion_factor: 0.8,
      f_flattening_factor: 0.4,
      f_repel_factor: 0.05,
      offset_scaler: 0.7,
    });
    return graph;
  }
  computeHeuristics() {
    let time = Date.now();
    this.graph_wasm.computeHeuristicLayout();
    this.graph_wasm.calculateNormals();
    this.graph_wasm.computeKnitPaths(this.cfg.loop_width, true);
    this.syncGraphWASM();
    console.log("Computed heuristics in", Date.now() - time);
  }
  dispose() {
    if (this.graph_wasm) {
      this.graph_wasm.delete();
      this.graph_wasm = null;
    }
    if (this.graph_sim) {
      this.graph_sim.delete();
      this.graph_sim = null;
    }
  }
}
