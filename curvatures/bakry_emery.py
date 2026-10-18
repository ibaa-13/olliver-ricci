import networkx as nx

import numpy as np

def compute_for_node(G, x):
    neighbors = list(G.neighbors(x))
    d = len(neighbors)

    if d == 0:
        return float(99999)

    segunda = set()
    for y in neighbors:
        segunda.update(G.neighbors(y))
    segunda -= {x, *neighbors}
    segunda = list(segunda)

    # Adyacencias entre vecinos de x.
    H = np.array([
        [G.has_edge(y, z) for z in neighbors]
        for y in neighbors
    ], dtype=float)

    # Adyacencias de los vecinos hacia la segunda capa.
    R = np.array([
        [G.has_edge(y, z) for z in segunda]
        for y in neighbors
    ], dtype=float)

    grados = np.array([G.degree[y] for y in neighbors])
    t = H.sum(axis=1)

    A = (
        np.diag((3 * grados - d + t) / 4)
        - H
        + 0.5 * np.ones((d, d))
    )

    # S = A - B C^{-1} B^T.
    S = A.copy()
    if segunda:
        r = R.sum(axis=0)
        S -= (R / r) @ R.T  # Divide cada columna por r[a].

    return float(2 * np.linalg.eigvalsh(S)[0])

def compute(graph: nx.Graph):
    values = {}
    for node in graph.nodes():
        values[str(node)] = compute_for_node(graph, node)
    return values

