# Ollivier–Ricci Graph Explorer

A local web application for creating and editing graphs and computing Ollivier–Ricci curvature on their edges.

## Install and run

```bash
conda create -n ricci python=3.12
conda activate ricci
pip install -r requirements.txt
python main.py
```

Open `http://127.0.0.1:5000`.

## Gestures

- Click empty space: create a vertex.
- Drag an unselected vertex onto another vertex: create an edge.
- Double-click a vertex or edge: select it.
- A selected vertex can be dragged to move it.
- Drag from empty space: box-select multiple elements.
- Ctrl/Shift + box selection: add elements to the current selection.
- Delete or Backspace: delete the current selection.
- Esc: clear the selection.
- R: recalculate curvature and edge colors.

## Known graph presets

The left panel contains a one-click collection of standard graphs, including paths, cycles, complete graphs, stars, wheels, complete bipartite graphs, the cube graph, the Petersen graph, the octahedral graph, and the triangular prism graph.

Loading a preset replaces the current graph, fits it to the canvas, clears previous curvature values, and synchronizes the JSON representation.

## JSON import and export

The JSON panel always represents the current graph. Copy its contents to export the graph. To import a graph, paste or edit the JSON and press `Ctrl+Enter` (`Cmd+Enter` on macOS).

The JSON includes `alpha`, vertex positions, and computed edge curvatures when available.
