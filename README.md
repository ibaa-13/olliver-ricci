# Discrete Curvature Graph Explorer

An interactive web application for creating, editing, importing, exporting, and analysing graphs with discrete curvature methods.

Ollivier-Ricci curvature is implemented now. The project is structured so additional edge-based, vertex-based, or graph-level curvature methods can be added without rewriting the editor.

## Install and run

You only need Python and `pip`:

```bash
pip install -r requirements.txt
python main.py
```

Open `http://127.0.0.1:5000`.

A virtual environment is optional but recommended:

```bash
python -m venv .venv
```

On Windows:

```bash
.venv\Scripts\activate
```

On macOS/Linux:

```bash
source .venv/bin/activate
```

Then install and run normally.

## Curvature selector

Click the curvature name at the top of the application to open the curvature selector.

Currently available:

- **Ollivier-Ricci Curvature** — edge based.

Placeholders are included for future methods such as Forman-Ricci and vertex curvature. They remain disabled until an implementation is registered.

Method-specific parameters are generated automatically from the Python registry. For example, Ollivier-Ricci declares the `alpha` parameter in `curvatures/registry.py`; it is not hardcoded in the HTML.

## Adding another curvature

Curvature code lives in:

```text
curvatures/
├── __init__.py
├── registry.py
├── ollivier.py
└── new_curvature_template.py
```

To add a new method:

1. Copy `curvatures/new_curvature_template.py` and rename it.
2. Implement its `compute(...)` function.
3. Import the function in `curvatures/registry.py`.
4. Add or enable its registry entry.
5. Set its `target` to `edges`, `nodes`, or `graph`.
6. Declare any parameters in the registry entry.

The frontend reads the registry through `GET /api/curvatures`, so registered methods automatically appear in the selector.

### Edge-based return format

An edge method returns:

```python
{
    (u, v): value,
    ...
}
```

The frontend colours edges and displays the numerical values.

### Node-based return format

A node method returns:

```python
{
    node_id: value,
    ...
}
```

The frontend colours vertices instead of edges.

### Graph-level return format

A graph-level method can return one number:

```python
0.42
```

or multiple named values:

```python
{
    "mean": 0.42,
    "minimum": -0.1,
}
```

Graph-level results do not colour individual nodes or edges.

## Backend API

`POST /api/curvature` receives a generic request:

```json
{
  "curvature": "ollivier",
  "parameters": {
    "alpha": 0.5
  },
  "nodes": [
    {"id": "v1"},
    {"id": "v2"}
  ],
  "edges": [
    {"id": "e1", "source": "v1", "target": "v2"}
  ]
}
```

It returns a generic result:

```json
{
  "curvature": {
    "id": "ollivier",
    "name": "Ollivier-Ricci Curvature",
    "target": "edges"
  },
  "parameters": {
    "alpha": 0.5
  },
  "values": [
    {"id": "e1", "value": 1.0}
  ],
  "stats": {
    "min": 1.0,
    "max": 1.0,
    "max_abs": 1.0
  }
}
```

The frontend uses `target` to decide whether to colour edges, vertices, or neither.

## Gestures

- Click empty space: create a vertex.
- Drag an unselected vertex onto another vertex: create an edge.
- Double-click a vertex or edge: select it.
- Drag a selected vertex: move it.
- Drag from empty space: box-select multiple elements.
- Ctrl/Shift + box selection: add elements to the selection.
- Delete or Backspace: delete the selection.
- Esc: clear the selection.
- R: calculate the currently selected curvature.

## Known graph presets

The left panel includes paths, cycles, complete graphs, stars, wheels, complete bipartite graphs, the cube graph, Petersen graph, octahedral graph, and triangular prism graph.

## JSON import and export

The JSON panel always represents the current graph and selected curvature configuration. Copy it to export. Paste JSON and press `Ctrl+Enter` (`Cmd+Enter` on macOS) to import.

The current format is version 2 and stores:

- selected curvature type,
- curvature-specific parameters,
- vertex positions,
- computed values on edges or vertices when applicable.

Older version-1 Ollivier-Ricci JSON files with a top-level `alpha` value are still accepted.
