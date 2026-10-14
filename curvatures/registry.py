from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .ollivier import compute as compute_ollivier_ricci
from .bakry_emery import compute as compute_bakry_emery

CurvatureFunction = Callable[..., Any]


# ---------------------------------------------------------------------------
# Curvature registry
# ---------------------------------------------------------------------------
#
# Add every new curvature here. The frontend reads this catalogue from
# GET /api/curvatures, so a registered method automatically appears in the
# title dropdown.
#
# target can currently be:
#   "edges" -> values are drawn on / used to colour edges
#   "nodes" -> values are drawn on / used to colour vertices
#   "graph" -> one or more graph-level values; no element is coloured
#
# To add a new implemented method:
#   1. Create curvatures/your_method.py with a compute(...) function.
#   2. Import that function here.
#   3. Add an entry with available=True and compute=<your function>.
#   4. Declare any method-specific parameters below.
#
# Example:
#   from .forman import compute as compute_forman_ricci
#
#   "forman": {
#       "id": "forman",
#       "name": "Forman-Ricci Curvature",
#       "short_name": "Forman-Ricci",
#       "target": "edges",
#       "description": "Forman curvature on graph edges.",
#       "available": True,
#       "parameters": [],
#       "compute": compute_forman_ricci,
#   },
#

CURVATURE_METHODS: dict[str, dict[str, Any]] = {
    "ollivier": {
        "id": "ollivier",
        "name": "Ollivier-Ricci Curvature",
        "short_name": "Ollivier-Ricci",
        "target": "edges",
        "description": "Optimal-transport curvature defined on graph edges.",
        "available": True,
        "parameters": [
            {
                "id": "alpha",
                "label": "Idleness α",
                "type": "number",
                "default": 0.5,
                "min": 0.0,
                "max": 1.0,
                "step": 0.05,
                "help": "Probability mass kept at the current vertex.",
            }
        ],
        "compute": compute_ollivier_ricci,
    },

    # -----------------------------------------------------------------------
    # Future methods shown in the selector as disabled placeholders.
    # Implement the corresponding module, import its compute function above,
    # set available=True, and assign it to "compute".
    # -----------------------------------------------------------------------
    "bakry-emery": {
        "id": "bakry-emery",
        "name": "Bakry-Émery Curvature",
        "short_name": "Bakry-Émery",
        "target": "nodes",
        "description": "Bakry-Émery curvature on graph vertices.",
        "available": False,
        "parameters": [],
        "compute": compute_bakry_emery,
    },
    "vertex-template": {
        "id": "vertex-template",
        "name": "Vertex Curvature",
        "short_name": "Vertex curvature",
        "target": "nodes",
        "description": "Example node-based curvature placeholder.",
        "available": False,
        "parameters": [],
        "compute": None,
    },
}


def get_method(method_id: str) -> dict[str, Any] | None:
    """Return the internal registry entry for one method."""
    return CURVATURE_METHODS.get(method_id)


def public_catalog() -> list[dict[str, Any]]:
    """Return registry metadata safe to expose to the browser."""
    result: list[dict[str, Any]] = []
    for method in CURVATURE_METHODS.values():
        result.append({
            key: value
            for key, value in method.items()
            if key != "compute"
        })
    return result
