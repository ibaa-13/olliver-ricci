from __future__ import annotations

import networkx as nx

def compute(graph: nx.Graph):
    """Return {node_id: curvature_value, ...}."""
    values = {}
    for node in graph.nodes():
        # TODO: implement your vertex curvature here.
        values[str(node)] = 0.0
    return values

