"""
Template for adding another curvature.

Copy this file, rename it, implement ``compute``, then register the method in
``curvatures/registry.py``. This file itself is intentionally not registered.
"""

from __future__ import annotations

import networkx as nx


# EDGE-BASED EXAMPLE ---------------------------------------------------------
# def compute(graph: nx.Graph, *, your_parameter: float = 1.0):
#     """Return {(u, v): curvature_value, ...}."""
#     values = {}
#     for u, v in graph.edges():
#         # TODO: implement your edge curvature here.
#         values[(u, v)] = 0.0
#     return values


# NODE-BASED EXAMPLE ---------------------------------------------------------
# def compute(graph: nx.Graph, *, your_parameter: float = 1.0):
#     """Return {node_id: curvature_value, ...}."""
#     values = {}
#     for node in graph.nodes():
#         # TODO: implement your vertex curvature here.
#         values[str(node)] = 0.0
#     return values


# GRAPH-LEVEL EXAMPLE --------------------------------------------------------
# def compute(graph: nx.Graph, **parameters):
#     """Return a scalar or a {name: value} dictionary."""
#     # TODO: implement your graph-level curvature here.
#     return 0.0
