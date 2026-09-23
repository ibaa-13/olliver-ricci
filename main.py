from __future__ import annotations

import os
from typing import Any

import networkx as nx
import numpy as np
from flask import Flask, jsonify, render_template, request
from scipy.optimize import linprog

app = Flask(__name__)

MAX_NODES = 200
MAX_EDGES = 1000


def wasserstein_distance(mu: np.ndarray, nu: np.ndarray, cost_matrix: np.ndarray) -> float:
    """Compute the Wasserstein-1 distance using a linear program."""
    n = len(mu)
    m = len(nu)
    c = cost_matrix.flatten()

    a_eq = []
    b_eq = []

    #restricciones
    for i in range(n):
        row = np.zeros(n * m)
        for j in range(m):
            row[i * m + j] = 1.0
        a_eq.append(row)
        b_eq.append(mu[i])

    for j in range(m):
        row = np.zeros(n * m)
        for i in range(n):
            row[i * m + j] = 1.0
        a_eq.append(row)
        b_eq.append(nu[j])

    result = linprog(
        c,
        A_eq=np.asarray(a_eq),
        b_eq=np.asarray(b_eq),
        bounds=[(0, None)] * (n * m),
        method="highs",
    )

    if not result.success:
        raise RuntimeError(f"Optimal transport could not be solved: {result.message}")

    return float(result.fun)


def probability_measure(graph: nx.Graph, node: str, alpha: float) -> tuple[list[str], np.ndarray]:
    """Build the lazy random-walk probability measure around one vertex."""
    neighbors = list(graph.neighbors(node))
    support = [node] + neighbors
    probabilities = np.zeros(len(support), dtype=float)
    probabilities[0] = alpha

    if neighbors:
        probabilities[1:] = (1.0 - alpha) / len(neighbors)
    else:
        probabilities[0] = 1.0

    return support, probabilities


def compute_ollivier_ricci(graph: nx.Graph, alpha: float = 0.5) -> dict[tuple[str, str], float]:
    """Compute Ollivier-Ricci curvature for every edge of an unweighted graph."""
    if graph.number_of_edges() == 0:
        return {}

    all_distances = dict(nx.all_pairs_shortest_path_length(graph))
    curvatures: dict[tuple[str, str], float] = {}

    for u, v in graph.edges():
        support_u, mu = probability_measure(graph, u, alpha)
        support_v, nu = probability_measure(graph, v, alpha)

        cost_matrix = np.zeros((len(support_u), len(support_v)), dtype=float)
        for i, node_u in enumerate(support_u):
            for j, node_v in enumerate(support_v):
                distance = all_distances[node_u].get(node_v)
                if distance is None:
                    raise RuntimeError(f"No path exists between {node_u} and {node_v}.")
                cost_matrix[i, j] = float(distance)

        wasserstein = wasserstein_distance(mu, nu, cost_matrix)
        d_uv = float(all_distances[u][v])
        curvature = 1.0 - (wasserstein / d_uv)

        if abs(curvature) < 1e-12:
            curvature = 0.0

        curvatures[(u, v)] = float(curvature)

    return curvatures


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/api/curvature")
def curvature():
    payload: dict[str, Any] = request.get_json(silent=True) or {}
    nodes = payload.get("nodes", [])
    edges = payload.get("edges", [])
    alpha = payload.get("alpha", 0.5)

    if not isinstance(nodes, list) or not isinstance(edges, list):
        return jsonify({"error": "nodes and edges must be arrays."}), 400

    if len(nodes) > MAX_NODES or len(edges) > MAX_EDGES:
        return jsonify({
            "error": f"Maximum size: {MAX_NODES} vertices and {MAX_EDGES} edges."
        }), 400

    try:
        alpha = float(alpha)
    except (TypeError, ValueError):
        return jsonify({"error": "alpha must be a number."}), 400

    if not 0.0 <= alpha <= 1.0:
        return jsonify({"error": "alpha must be between 0 and 1."}), 400

    graph = nx.Graph()
    node_ids: set[str] = set()

    for raw_node in nodes:
        node_id = str(raw_node.get("id", "") if isinstance(raw_node, dict) else raw_node).strip()
        if not node_id:
            return jsonify({"error": "Every vertex must have an id."}), 400
        if node_id in node_ids:
            return jsonify({"error": f"Duplicate vertex: {node_id}"}), 400
        node_ids.add(node_id)
        graph.add_node(node_id)

    normalized_edges: list[tuple[str, str, str]] = []
    seen_pairs: set[tuple[str, str]] = set()

    for index, edge in enumerate(edges):
        if not isinstance(edge, dict):
            return jsonify({"error": "Every edge must be an object."}), 400

        source = str(edge.get("source", "")).strip()
        target = str(edge.get("target", "")).strip()
        edge_id = str(edge.get("id", f"e{index}"))

        if source not in node_ids or target not in node_ids:
            return jsonify({"error": f"Edge {edge_id} references a missing vertex."}), 400
        if source == target:
            return jsonify({"error": "Self-loops are not supported."}), 400

        pair = tuple(sorted((source, target)))
        if pair in seen_pairs:
            return jsonify({"error": f"Duplicate edge between {source} and {target}."}), 400

        seen_pairs.add(pair)
        graph.add_edge(source, target)
        normalized_edges.append((edge_id, source, target))

    if graph.number_of_edges() == 0:
        return jsonify({
            "edges": [],
            "stats": {"min": 0.0, "max": 0.0, "max_abs": 1.0},
            "alpha": alpha,
        })

    try:
        curvatures = compute_ollivier_ricci(graph, alpha)
    except Exception as exc:
        app.logger.exception("Error computing Ollivier-Ricci curvature")
        return jsonify({
            "error": "Ollivier-Ricci curvature could not be computed.",
            "detail": str(exc),
        }), 500

    result_edges = []
    values = []

    for edge_id, source, target in normalized_edges:
        value = curvatures.get((source, target), curvatures.get((target, source), 0.0))
        value = float(value)
        values.append(value)
        result_edges.append({
            "id": edge_id,
            "source": source,
            "target": target,
            "curvature": value,
        })

    min_value = min(values)
    max_value = max(values)
    max_abs = max(abs(min_value), abs(max_value), 1e-12)

    return jsonify({
        "edges": result_edges,
        "stats": {"min": min_value, "max": max_value, "max_abs": max_abs},
        "alpha": alpha,
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    print(f"Open http://127.0.0.1:{port}")
    app.run(host="127.0.0.1", port=port, debug=True, use_reloader=False)
