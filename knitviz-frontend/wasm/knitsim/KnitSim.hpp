#pragma once
#include "graph/Graph.hpp"
#include <algorithm>
#include <cmath>
#include <limits>
namespace knitsim {
  class KnitSimConfig {
   public:
    float f_flattening_factor = 0.1;
    float f_expansion_factor = 0.2;
    float f_repel_factor = 0.1;
    float offset_scaler = 0.8;
  };
  class KnitNodeWrapper {
   public:
    Node *node;
    Eigen::Vector3f velocity = Eigen::Vector3f(0, 0, 0);
    Eigen::Vector3f force = Eigen::Vector3f(0, 0, 0);

   public:
    KnitNodeWrapper() : node(nullptr) {}
    KnitNodeWrapper(Node *node) : node(node) {}
  };
  class KnitSim {
   private:
    KnitGraphC &graph;
    KnitSimConfig cfg;
    std::map<uint32_t, KnitNodeWrapper> wrappers;
    Eigen::Vector3f reference_center = Eigen::Vector3f(0, 0, 0);

   public:
    KnitSim(KnitGraphC &graph, KnitSimConfig cfg) : graph(graph), cfg(cfg) { initialize(); }
    void initialize() {
      wrappers.clear();
      for (auto &node : graph.getNodes()) {
        auto wrapper = KnitNodeWrapper(&node);
        wrappers[node.id] = wrapper;
      }
      graph.computeHeuristicLayout();
      reference_center = graph.center();
      graph.calculateNormals();
      computeForces();
    }
    Eigen::Vector3f getForce(uint32_t id) {
      if (wrappers.find(id) == wrappers.end()) {
        return Eigen::Vector3f(0, 0, 0);
      }
      return wrappers.at(id).force;
    }
    float computeForces() {
      for (auto &wrapper : wrappers) {
        wrapper.second.force = Eigen::Vector3f(0, 0, 0);
      }
      for (auto &kv : wrappers) {
        auto &wrapper = kv.second;
        auto node = wrapper.node;
        auto edges = graph.edgesOf(*node);
        auto node_force = Eigen::Vector3f(0, 0, 0);
        for (auto &edge : edges) {
          float target_len = 0;
          switch (edge.direction) {
          case KnitEdgeDirectionC::ROW:
            target_len = graph.getConfig().step_size_x * cfg.offset_scaler;
            break;
          case KnitEdgeDirectionC::COLUMN:
            target_len = graph.getConfig().step_size_y * cfg.offset_scaler;
            break;
          default:
            break;
          }
          auto other_node = edge.from == node->id ? graph.getNode(edge.to) : graph.getNode(edge.from);
          auto edge_v = other_node.position - node->position;
          auto edge_dir = edge_v.normalized();
          auto expansion_force = edge_v.norm() - target_len;
          node_force += edge_dir * expansion_force * cfg.f_expansion_factor;

          auto edge_angle = edge_dir.dot(node->normal);
          auto flattening_force = edge_angle * cfg.f_flattening_factor;
          wrappers[other_node.id].force += -node->normal * flattening_force;
        }
        wrappers[node->id].force += node_force;
      }
      auto minimum_distance =
          std::min(std::abs(graph.getConfig().step_size_x), std::abs(graph.getConfig().step_size_y)) * 0.2f;
      auto minimum_squared_distance = minimum_distance * minimum_distance;
      for (auto &wrapper : wrappers) {
        auto node = wrapper.second.node;
        auto neighbors = graph.neighbours(*node);
        for (auto &neighbor : neighbors) {
          auto difference = node->position - neighbor.position;
          auto squared_distance = difference.squaredNorm();
          if (!std::isfinite(squared_distance) || squared_distance <= std::numeric_limits<float>::epsilon()) {
            continue;
          }
          auto safe_squared_distance = std::max(squared_distance, minimum_squared_distance);
          auto repel_force = cfg.f_repel_factor / safe_squared_distance;
          wrappers[node->id].force += repel_force * difference.normalized();
        }
      }
      float total_force = 0;
      for (auto &wrapper : wrappers) {
        total_force += wrapper.second.force.norm();
      }
      return total_force;
    }
    float step(float time, float damping = 0.2, float force_damping = 0.2) {
      // std::cout << "Calculating Normals" << std::endl;
      graph.calculateNormals();
      // std::cout << "Calculating Forces" << std::endl;
      float total = computeForces();
      std::cout << "Total Force:" << total << std::endl;
      if (!std::isfinite(total)) {
        return std::numeric_limits<float>::quiet_NaN();
      }
      // std::cout << "Stepping" << std::endl;
      float acc_differences = 0;
      auto next_center = Eigen::Vector3f(0, 0, 0);
      std::map<uint32_t, Eigen::Vector3f> next_velocities;
      std::map<uint32_t, Eigen::Vector3f> position_deltas;
      for (auto &kv : wrappers) {
        auto &wrapper = kv.second;
        auto node = wrapper.node;
        auto force = wrapper.force;
        auto vel_damped = wrapper.velocity * (1 - damping);
        auto acceleration = force * force_damping;
        auto next_velocity = acceleration * time + vel_damped;
        auto pos_delta = next_velocity * time;
        auto next_position = node->position + pos_delta;
        if (!force.allFinite() || !next_velocity.allFinite() || !pos_delta.allFinite() ||
            !next_position.allFinite()) {
          return std::numeric_limits<float>::quiet_NaN();
        }
        next_velocities[node->id] = next_velocity;
        position_deltas[node->id] = pos_delta;
        next_center += next_position;
        acc_differences += pos_delta.norm();
      }
      if (!std::isfinite(acc_differences)) {
        return std::numeric_limits<float>::quiet_NaN();
      }
      if (!wrappers.empty()) {
        next_center /= static_cast<float>(wrappers.size());
      }
      auto center_correction = (reference_center - next_center) * damping;
      std::map<uint32_t, Eigen::Vector3f> next_positions;
      for (auto &kv : wrappers) {
        auto node = kv.second.node;
        auto next_position = node->position + position_deltas.at(node->id) + center_correction;
        if (!next_position.allFinite()) {
          return std::numeric_limits<float>::quiet_NaN();
        }
        next_positions[node->id] = next_position;
      }
      for (auto &kv : wrappers) {
        auto &wrapper = kv.second;
        auto node = wrapper.node;
        wrapper.velocity = next_velocities.at(node->id);
        node->position = next_positions.at(node->id);
      }
      graph.computeKnitPaths();
      return acc_differences;
    }
  };
} // namespace knitsim
