from __future__ import annotations

import os
from typing import Any

import networkx as nx
from flask import Flask, jsonify, render_template, request

from curvatures import get_method, public_catalog

app = Flask(__name__)

MAX_NODES = 200
MAX_EDGES = 1000
VALID_TARGETS = {"edges", "nodes", "graph"}


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/curvatures")
def curvature_catalog():
    """Expose curvature metadata used to build the selector and parameter UI."""
    return jsonify({"curvatures": public_catalog()})


def _build_graph(
    nodes: list[Any],
    edges: list[Any],
) -> tuple[nx.Graph, list[tuple[str, str, str]]]:
    """Validate the JSON graph and convert it to NetworkX."""
    if len(nodes) > MAX_NODES or len(edges) > MAX_EDGES:
        raise ValueError(
            f"Maximum size: {MAX_NODES} vertices and {MAX_EDGES} edges."
        )

    graph = nx.Graph()
    node_ids: set[str] = set()

    for raw_node in nodes:
        node_id = str(
            raw_node.get("id", "") if isinstance(raw_node, dict) else raw_node
        ).strip()

        if not node_id:
            raise ValueError("Every vertex must have an id.")
        if node_id in node_ids:
            raise ValueError(f"Duplicate vertex: {node_id}")

        node_ids.add(node_id)
        graph.add_node(node_id)

    normalized_edges: list[tuple[str, str, str]] = []
    seen_pairs: set[tuple[str, str]] = set()

    for index, edge in enumerate(edges):
        if not isinstance(edge, dict):
            raise ValueError("Every edge must be an object.")

        source = str(edge.get("source", "")).strip()
        target = str(edge.get("target", "")).strip()
        edge_id = str(edge.get("id", f"e{index}"))

        if source not in node_ids or target not in node_ids:
            raise ValueError(f"Edge {edge_id} references a missing vertex.")
        if source == target:
            raise ValueError("Self-loops are not supported.")

        pair = tuple(sorted((source, target)))
        if pair in seen_pairs:
            raise ValueError(f"Duplicate edge between {source} and {target}.")

        seen_pairs.add(pair)
        graph.add_edge(source, target, edge_id=edge_id)
        normalized_edges.append((edge_id, source, target))

    return graph, normalized_edges


def _parse_parameters(
    method: dict[str, Any],
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Validate parameters declared by the selected curvature method."""
    supplied = payload.get("parameters", {})
    if supplied is None:
        supplied = {}
    if not isinstance(supplied, dict):
        raise ValueError("parameters must be an object.")

    parsed: dict[str, Any] = {}

    for spec in method.get("parameters", []):
        parameter_id = str(spec["id"])

        # Backward compatibility with the previous API, where alpha lived at
        # the top level of the request.
        if parameter_id in supplied:
            raw_value = supplied[parameter_id]
        elif parameter_id in payload:
            raw_value = payload[parameter_id]
        else:
            raw_value = spec.get("default")

        parameter_type = spec.get("type", "number")

        if parameter_type == "number":
            try:
                value = float(raw_value)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"{spec.get('label', parameter_id)} must be a number.") from exc

            minimum = spec.get("min")
            maximum = spec.get("max")
            if minimum is not None and value < float(minimum):
                raise ValueError(f"{spec.get('label', parameter_id)} must be at least {minimum}.")
            if maximum is not None and value > float(maximum):
                raise ValueError(f"{spec.get('label', parameter_id)} must be at most {maximum}.")

            parsed[parameter_id] = value
        else:
            # Add parsing for future parameter types here, for example:
            # "integer", "boolean", "select", ...
            parsed[parameter_id] = raw_value

    return parsed


def _serialize_result(
    target: str,
    raw_values: Any,
    graph: nx.Graph,
    normalized_edges: list[tuple[str, str, str]],
) -> list[dict[str, Any]]:
    """Convert a method-specific Python result into the generic browser format."""
    if target == "edges":
        if not isinstance(raw_values, dict):
            raise TypeError("Edge curvature functions must return a dictionary.")

        result: list[dict[str, Any]] = []
        for edge_id, source, target_node in normalized_edges:
            value = raw_values.get(
                (source, target_node),
                raw_values.get((target_node, source)),
            )
            if value is None:
                continue
            result.append({"id": edge_id, "value": float(value)})
        return result

    if target == "nodes":
        if not isinstance(raw_values, dict):
            raise TypeError("Node curvature functions must return a dictionary.")

        result = []
        for node_id in graph.nodes():
            value = raw_values.get(node_id)
            if value is None:
                continue
            result.append({"id": str(node_id), "value": float(value)})
        return result

    if target == "graph":
        if isinstance(raw_values, dict):
            return [
                {"id": str(name), "value": float(value)}
                for name, value in raw_values.items()
            ]
        return [{"id": "graph", "value": float(raw_values)}]

    raise ValueError(f"Unsupported curvature target: {target}")


def _stats(values: list[dict[str, Any]]) -> dict[str, float]:
    numbers = [float(item["value"]) for item in values]
    if not numbers:
        return {"min": 0.0, "max": 0.0, "max_abs": 1.0}

    minimum = min(numbers)
    maximum = max(numbers)
    return {
        "min": minimum,
        "max": maximum,
        "max_abs": max(abs(minimum), abs(maximum), 1e-12),
    }


@app.post("/api/curvature")
def curvature():
    payload: dict[str, Any] = request.get_json(silent=True) or {}
    nodes = payload.get("nodes", [])
    edges = payload.get("edges", [])
    method_id = str(payload.get("curvature", "ollivier"))

    if not isinstance(nodes, list) or not isinstance(edges, list):
        return jsonify({"error": "nodes and edges must be arrays."}), 400

    method = get_method(method_id)
    if method is None:
        return jsonify({"error": f"Unknown curvature method: {method_id}"}), 400
    if not method.get("available", False) or method.get("compute") is None:
        return jsonify({"error": f"{method['name']} is not implemented yet."}), 400

    target = str(method.get("target", ""))
    if target not in VALID_TARGETS:
        return jsonify({"error": f"Invalid target configured for {method['name']}."}), 500

    try:
        graph, normalized_edges = _build_graph(nodes, edges)
        parameters = _parse_parameters(method, payload)
        raw_values = method["compute"](graph, **parameters)
        values = _serialize_result(target, raw_values, graph, normalized_edges)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        app.logger.exception("Error computing %s", method["name"])
        return jsonify({
            "error": f"{method['name']} could not be computed.",
            "detail": str(exc),
        }), 500

    return jsonify({
        "curvature": {
            "id": method["id"],
            "name": method["name"],
            "target": target,
        },
        "parameters": parameters,
        "values": values,
        "stats": _stats(values),
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    print(f"Open http://127.0.0.1:{port}")
    app.run(host="0.0.0.0", port=port, debug=debug, use_reloader=False)
