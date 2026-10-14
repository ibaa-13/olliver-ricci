from __future__ import annotations

import networkx as nx
import numpy as np
from scipy.optimize import linprog


def _wasserstein_distance(
    mu: np.ndarray,
    nu: np.ndarray,
    cost_matrix: np.ndarray,
) -> float:
    """Compute Wasserstein-1 distance with a linear program."""
    n = len(mu)
    m = len(nu)
    objective = cost_matrix.flatten()

    a_eq: list[np.ndarray] = []
    b_eq: list[float] = []

    # Every source probability must be fully transported.
    for i in range(n):
        row = np.zeros(n * m)
        for j in range(m):
            row[i * m + j] = 1.0
        a_eq.append(row)
        b_eq.append(float(mu[i]))

    # Every target probability must receive the required mass.
    for j in range(m):
        row = np.zeros(n * m)
        for i in range(n):
            row[i * m + j] = 1.0
        a_eq.append(row)
        b_eq.append(float(nu[j]))

    result = linprog(
        objective,
        A_eq=np.asarray(a_eq),
        b_eq=np.asarray(b_eq),
        bounds=[(0, None)] * (n * m),
        method="highs",
    )

    if not result.success:
        raise RuntimeError(f"Optimal transport could not be solved: {result.message}")

    return float(result.fun)


def _probability_measure(
    graph: nx.Graph,
    node: str,
    alpha: float,
) -> tuple[list[str], np.ndarray]:
    """Build the lazy random-walk measure around one vertex."""
    neighbors = list(graph.neighbors(node))
    support = [node] + neighbors
    probabilities = np.zeros(len(support), dtype=float)
    probabilities[0] = alpha

    if neighbors:
        probabilities[1:] = (1.0 - alpha) / len(neighbors)
    else:
        probabilities[0] = 1.0

    return support, probabilities


def compute(
    graph: nx.Graph,
    *,
    alpha: float = 0.5,
) -> dict[tuple[str, str], float]:
    """
    Compute Ollivier-Ricci curvature on every edge of an unweighted graph.

    The returned dictionary is keyed by NetworkX edge tuples. ``main.py``
    converts these tuples to the edge ids used by the browser.
    """
    if graph.number_of_edges() == 0:
        return {}

    all_distances = dict(nx.all_pairs_shortest_path_length(graph))
    curvatures: dict[tuple[str, str], float] = {}

    for u, v in graph.edges():
        support_u, mu = _probability_measure(graph, u, alpha)
        support_v, nu = _probability_measure(graph, v, alpha)

        cost_matrix = np.zeros((len(support_u), len(support_v)), dtype=float)
        for i, node_u in enumerate(support_u):
            for j, node_v in enumerate(support_v):
                distance = all_distances[node_u].get(node_v)
                if distance is None:
                    raise RuntimeError(f"No path exists between {node_u} and {node_v}.")
                cost_matrix[i, j] = float(distance)

        wasserstein = _wasserstein_distance(mu, nu, cost_matrix)
        edge_distance = float(all_distances[u][v])
        curvature = 1.0 - (wasserstein / edge_distance)

        if abs(curvature) < 1e-12:
            curvature = 0.0

        curvatures[(u, v)] = float(curvature)

    return curvatures
