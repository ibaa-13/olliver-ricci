(() => {
  const cyContainer = document.getElementById('cy');
  const statusEl = document.getElementById('status');
  const nodeCountEl = document.getElementById('node-count');
  const edgeCountEl = document.getElementById('edge-count');
  const minEl = document.getElementById('min-curvature');
  const maxEl = document.getElementById('max-curvature');
  const selectionBox = document.getElementById('selection-box');
  const edgePreview = document.getElementById('edge-preview');
  const edgePreviewLine = document.getElementById('edge-preview-line');
  const jsonTextarea = document.getElementById('graph-json');
  const jsonStatusEl = document.getElementById('json-status');
  const presetListEl = document.getElementById('preset-list');

  const curvatureTitle = document.getElementById('curvature-title');
  const curvatureTitleText = document.getElementById('curvature-title-text');
  const curvatureMenu = document.getElementById('curvature-menu');
  const curvatureParametersEl = document.getElementById('curvature-parameters');
  const curvatureDescriptionEl = document.getElementById('curvature-description');
  const curvatureTargetLabelEl = document.getElementById('curvature-target-label');
  const legendTitleEl = document.getElementById('legend-title');

  const DRAG_THRESHOLD = 6;
  const NODE_HIT_PADDING = 9;
  const EDGE_HIT_DISTANCE = 9;
  const DOUBLE_CLICK_MS = 350;

  // Fallback metadata keeps the UI usable if the catalogue request fails.
  // The authoritative catalogue comes from curvatures/registry.py.
  const FALLBACK_CURVATURES = [
    {
      id: 'ollivier',
      name: 'Ollivier-Ricci Curvature',
      short_name: 'Ollivier-Ricci',
      target: 'edges',
      description: 'Optimal-transport curvature defined on graph edges.',
      available: true,
      parameters: [
        {
          id: 'alpha',
          label: 'Idleness α',
          type: 'number',
          default: 0.5,
          min: 0,
          max: 1,
          step: 0.05,
          help: 'Probability mass kept at the current vertex.',
        },
      ],
    },
    {
      id: 'forman',
      name: 'Forman-Ricci Curvature',
      short_name: 'Forman-Ricci',
      target: 'edges',
      description: 'Edge-based curvature placeholder for a future implementation.',
      available: false,
      parameters: [],
    },
    {
      id: 'vertex-template',
      name: 'Vertex Curvature',
      short_name: 'Vertex curvature',
      target: 'nodes',
      description: 'Example node-based curvature placeholder.',
      available: false,
      parameters: [],
    },
  ];

  let nodeCounter = 0;
  let edgeCounter = 0;
  let gesture = null;
  let lastElementTap = { id: null, group: null, time: 0 };
  let jsonDirty = false;

  let curvatureCatalog = [...FALLBACK_CURVATURES];
  let selectedCurvature = 'ollivier';
  let graphCurvatureValues = [];
  const parameterState = new Map();

  const cy = cytoscape({
    container: cyContainer,
    elements: [],
    style: [
      {
        selector: 'node',
        style: {
          'background-color': '#111827',
          'border-color': '#ffffff',
          'border-width': 2,
          'label': 'data(label)',
          'color': '#111827',
          'font-size': 13,
          'font-weight': 700,
          'text-valign': 'bottom',
          'text-margin-y': 10,
          'width': 30,
          'height': 30,
        },
      },
      {
        selector: 'node.chosen',
        style: {
          'background-color': '#2563eb',
          'border-color': '#93c5fd',
          'border-width': 4,
        },
      },
      {
        selector: 'edge',
        style: {
          'width': 5,
          'line-color': '#94a3b8',
          'curve-style': 'bezier',
          'label': '',
        },
      },
      {
        selector: 'edge.chosen',
        style: {
          'width': 8,
          'line-color': '#0f172a',
          'overlay-color': '#2563eb',
          'overlay-opacity': 0.08,
          'overlay-padding': 5,
        },
      },
    ],
    layout: { name: 'preset' },
    minZoom: 0.25,
    maxZoom: 4,
    autounselectify: true,
    boxSelectionEnabled: false,
    userPanningEnabled: false,
  });

  function setStatus(message, kind = 'normal') {
    statusEl.textContent = message;
    statusEl.dataset.kind = kind;
  }

  function setJsonStatus(message, kind = 'normal') {
    jsonStatusEl.textContent = message;
    jsonStatusEl.dataset.kind = kind;
  }

  function updateCounts() {
    nodeCountEl.textContent = String(cy.nodes().length);
    edgeCountEl.textContent = String(cy.edges().length);
  }

  function getMethod(methodId = selectedCurvature) {
    return curvatureCatalog.find((method) => method.id === methodId) || null;
  }

  function selectedMethod() {
    return getMethod(selectedCurvature) || FALLBACK_CURVATURES[0];
  }

  function targetLabel(target) {
    if (target === 'edges') return 'Edges';
    if (target === 'nodes') return 'Vertices';
    if (target === 'graph') return 'Graph';
    return target;
  }

  function parameterDefaults(method) {
    const values = {};
    (method.parameters || []).forEach((spec) => {
      values[spec.id] = spec.default;
    });
    return values;
  }

  function validateParameters(method, parameters) {
    const parsed = {};

    (method.parameters || []).forEach((spec) => {
      const raw = parameters[spec.id] ?? spec.default;

      if ((spec.type || 'number') === 'number') {
        const value = Number(raw);
        if (!Number.isFinite(value)) {
          throw new Error(`${spec.label || spec.id} must be a number.`);
        }
        if (spec.min !== undefined && value < Number(spec.min)) {
          throw new Error(`${spec.label || spec.id} must be at least ${spec.min}.`);
        }
        if (spec.max !== undefined && value > Number(spec.max)) {
          throw new Error(`${spec.label || spec.id} must be at most ${spec.max}.`);
        }
        parsed[spec.id] = value;
        return;
      }

      // Add parsing for future parameter types here if needed.
      parsed[spec.id] = raw;
    });

    return parsed;
  }

  function readParameterControls() {
    const method = selectedMethod();
    const values = {};

    (method.parameters || []).forEach((spec) => {
      const input = curvatureParametersEl.querySelector(`[data-parameter-id="${CSS.escape(spec.id)}"]`);
      if (!input) return;
      values[spec.id] = spec.type === 'number' ? Number(input.value) : input.value;
    });

    return validateParameters(method, values);
  }

  function rememberCurrentParameters() {
    try {
      parameterState.set(selectedCurvature, readParameterControls());
    } catch (_) {
      // Invalid user input is intentionally not persisted as method state.
    }
  }

  function renderParameterControls(method, suppliedValues = null) {
    curvatureParametersEl.replaceChildren();

    const previous = suppliedValues
      || parameterState.get(method.id)
      || parameterDefaults(method);

    if (!(method.parameters || []).length) {
      const empty = document.createElement('p');
      empty.className = 'no-parameters';
      empty.textContent = 'No parameters for this curvature.';
      curvatureParametersEl.appendChild(empty);
      parameterState.set(method.id, {});
      return;
    }

    (method.parameters || []).forEach((spec) => {
      const label = document.createElement('label');
      label.className = 'parameter-control';

      const labelText = document.createElement('span');
      labelText.className = 'parameter-label';
      labelText.textContent = spec.label || spec.id;
      label.appendChild(labelText);

      let input;
      if ((spec.type || 'number') === 'number') {
        input = document.createElement('input');
        input.type = 'number';
        if (spec.min !== undefined) input.min = String(spec.min);
        if (spec.max !== undefined) input.max = String(spec.max);
        if (spec.step !== undefined) input.step = String(spec.step);
      } else {
        // Future parameter types can be rendered here.
        input = document.createElement('input');
        input.type = 'text';
      }

      input.dataset.parameterId = spec.id;
      const value = previous[spec.id] ?? spec.default ?? '';
      input.value = String(value);
      label.appendChild(input);

      if (spec.help) {
        const help = document.createElement('small');
        help.textContent = spec.help;
        label.appendChild(help);
      }

      input.addEventListener('change', () => {
        try {
          const parameters = readParameterControls();
          parameterState.set(method.id, parameters);
          invalidateCurvature(`${method.short_name || method.name} parameters changed. Press R to recalculate.`);
          syncJsonFromGraph();
        } catch (error) {
          setStatus(error.message, 'error');
        }
      });

      curvatureParametersEl.appendChild(label);
    });

    try {
      parameterState.set(method.id, validateParameters(method, previous));
    } catch (_) {
      parameterState.set(method.id, parameterDefaults(method));
    }
  }

  function renderCurvatureMenu() {
    curvatureMenu.replaceChildren();

    curvatureCatalog.forEach((method) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'curvature-option';
      button.setAttribute('role', 'menuitem');
      button.dataset.curvature = method.id;
      button.disabled = !method.available;

      const content = document.createElement('span');
      content.className = 'curvature-option-main';

      const name = document.createElement('strong');
      name.textContent = method.short_name || method.name;
      content.appendChild(name);

      const target = document.createElement('small');
      target.textContent = targetLabel(method.target);
      content.appendChild(target);
      button.appendChild(content);

      if (!method.available) {
        const badge = document.createElement('span');
        badge.className = 'coming-soon';
        badge.textContent = 'Coming soon';
        button.appendChild(badge);
      }

      if (method.id === selectedCurvature) button.classList.add('active');

      button.addEventListener('click', () => {
        if (!method.available) return;
        selectCurvature(method.id);
      });

      curvatureMenu.appendChild(button);
    });
  }

  function updateCurvatureUi(method) {
    curvatureTitleText.textContent = method.name;
    curvatureDescriptionEl.textContent = method.description || '';
    curvatureTargetLabelEl.textContent = targetLabel(method.target);
    legendTitleEl.textContent = method.target === 'graph'
      ? 'Graph-level curvature'
      : `Curvature on ${method.target}`;
    renderCurvatureMenu();
  }

  function openCurvatureMenu() {
    curvatureMenu.hidden = false;
    curvatureTitle.setAttribute('aria-expanded', 'true');
  }

  function closeCurvatureMenu() {
    curvatureMenu.hidden = true;
    curvatureTitle.setAttribute('aria-expanded', 'false');
  }

  function selectCurvature(methodId, options = {}) {
    const {
      invalidate = true,
      parameters = null,
      syncJson = true,
      announce = true,
    } = options;

    const method = getMethod(methodId);
    if (!method || !method.available) return false;

    if (methodId !== selectedCurvature) rememberCurrentParameters();
    selectedCurvature = methodId;

    if (parameters) parameterState.set(method.id, validateParameters(method, parameters));

    updateCurvatureUi(method);
    renderParameterControls(method, parameters);
    closeCurvatureMenu();

    if (invalidate) {
      invalidateCurvature(`${method.short_name || method.name} selected. Press R to calculate.`);
    } else {
      resetCurvatureStyles();
      applyCurvatureStyles(method.target);
    }

    if (syncJson) syncJsonFromGraph();
    if (announce && !invalidate) setStatus(`${method.name} selected.`);
    return true;
  }

  async function loadCurvatureCatalog() {
    try {
      const response = await fetch('/api/curvatures');
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.curvatures)) {
        throw new Error(data.error || 'Invalid curvature catalogue.');
      }
      curvatureCatalog = data.curvatures;
    } catch (error) {
      curvatureCatalog = [...FALLBACK_CURVATURES];
      setStatus(`Could not load the curvature catalogue; using fallback metadata. ${error.message}`, 'error');
    }

    const chosen = getMethod(selectedCurvature)?.available
      ? selectedCurvature
      : curvatureCatalog.find((method) => method.available)?.id;

    if (!chosen) {
      throw new Error('No curvature method is available.');
    }

    selectCurvature(chosen, {
      invalidate: false,
      syncJson: false,
      announce: false,
    });
  }

  curvatureTitle.addEventListener('click', (event) => {
    event.stopPropagation();
    if (curvatureMenu.hidden) openCurvatureMenu();
    else closeCurvatureMenu();
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.curvature-selector')) closeCurvatureMenu();
  });

  function nextNodeId() {
    do {
      nodeCounter += 1;
    } while (cy.getElementById(`v${nodeCounter}`).length);
    return `v${nodeCounter}`;
  }

  function nextEdgeId() {
    do {
      edgeCounter += 1;
    } while (cy.getElementById(`e${edgeCounter}`).length);
    return `e${edgeCounter}`;
  }

  function refreshCountersFromIds() {
    let maxNode = 0;
    let maxEdge = 0;

    cy.nodes().forEach((node) => {
      const match = /^v(\d+)$/.exec(node.id());
      if (match) maxNode = Math.max(maxNode, Number(match[1]));
    });

    cy.edges().forEach((edge) => {
      const match = /^e(\d+)$/.exec(edge.id());
      if (match) maxEdge = Math.max(maxEdge, Number(match[1]));
    });

    nodeCounter = maxNode;
    edgeCounter = maxEdge;
  }

  function modelPositionFromRendered(rendered) {
    const pan = cy.pan();
    const zoom = cy.zoom();
    return {
      x: (rendered.x - pan.x) / zoom,
      y: (rendered.y - pan.y) / zoom,
    };
  }

  function localPointerPosition(event) {
    const rect = cyContainer.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function pointDistanceToSegment(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
      return Math.hypot(point.x - start.x, point.y - start.y);
    }

    const t = Math.max(
      0,
      Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)
    );
    const projected = { x: start.x + t * dx, y: start.y + t * dy };
    return Math.hypot(point.x - projected.x, point.y - projected.y);
  }

  function hitTestNode(renderedPoint, excludeId = null) {
    let best = null;
    let bestDistance = Infinity;

    cy.nodes().forEach((node) => {
      if (node.id() === excludeId) return;
      const p = node.renderedPosition();
      const radius = Math.max(node.renderedOuterWidth(), node.renderedOuterHeight()) / 2 + NODE_HIT_PADDING;
      const distance = Math.hypot(renderedPoint.x - p.x, renderedPoint.y - p.y);
      if (distance <= radius && distance < bestDistance) {
        best = node;
        bestDistance = distance;
      }
    });

    return best;
  }

  function hitTestEdge(renderedPoint) {
    let best = null;
    let bestDistance = Infinity;

    cy.edges().forEach((edge) => {
      const source = edge.source().renderedPosition();
      const target = edge.target().renderedPosition();
      const distance = pointDistanceToSegment(renderedPoint, source, target);
      if (distance <= EDGE_HIT_DISTANCE && distance < bestDistance) {
        best = edge;
        bestDistance = distance;
      }
    });

    return best;
  }

  function elementAt(renderedPoint) {
    return hitTestNode(renderedPoint) || hitTestEdge(renderedPoint);
  }

  function clearChosen() {
    cy.$('.chosen').removeClass('chosen');
    cy.nodes().ungrabify();
  }

  function toggleChosen(element, additive = false) {
    if (!additive) {
      const wasChosen = element.hasClass('chosen');
      clearChosen();
      if (!wasChosen) {
        element.addClass('chosen');
        if (element.isNode()) element.grabify();
      }
      return;
    }

    if (element.hasClass('chosen')) {
      element.removeClass('chosen');
      if (element.isNode()) element.ungrabify();
    } else {
      element.addClass('chosen');
      if (element.isNode()) element.grabify();
    }
  }

  function edgeExists(source, target) {
    return cy.edges().some((edge) => {
      const s = edge.data('source');
      const t = edge.data('target');
      return (s === source && t === target) || (s === target && t === source);
    });
  }

  function addNodeAtRendered(renderedPosition) {
    const id = nextNodeId();
    cy.add({
      group: 'nodes',
      data: { id, label: id.slice(1) },
      position: modelPositionFromRendered(renderedPosition),
      grabbable: false,
    });
    updateCounts();
    invalidateCurvature('Vertex added. Press R to recalculate.');
    syncJsonFromGraph();
    return id;
  }

  function addEdge(sourceId, targetId) {
    if (sourceId === targetId) return false;
    if (edgeExists(sourceId, targetId)) {
      setStatus('Those vertices are already connected.', 'error');
      return false;
    }

    cy.add({
      group: 'edges',
      data: {
        id: nextEdgeId(),
        source: sourceId,
        target: targetId,
      },
    });

    updateCounts();
    invalidateCurvature('Edge created. Press R to recalculate.');
    syncJsonFromGraph();
    return true;
  }

  function deleteChosen() {
    const chosen = cy.$('.chosen');
    if (!chosen.length) {
      setStatus('No elements are selected.', 'error');
      return;
    }

    chosen.remove();
    clearChosen();
    updateCounts();
    invalidateCurvature('Selection deleted. Press R to recalculate.');
    syncJsonFromGraph();
  }

  function resetCurvatureStyles() {
    // removeStyle() clears only per-element overrides; the Cytoscape stylesheet
    // (including the selection styles) remains active.
    cy.nodes().removeStyle();
    cy.edges().removeStyle();
  }

  function clearCurvatureData() {
    cy.nodes().forEach((node) => node.removeData('curvature'));
    cy.edges().forEach((edge) => edge.removeData('curvature'));
    graphCurvatureValues = [];
  }

  function invalidateCurvature(message = 'The graph changed. Press R to recalculate.') {
    clearCurvatureData();
    resetCurvatureStyles();
    minEl.textContent = '—';
    maxEl.textContent = '—';
    setStatus(message);
  }

  function curvatureColor(value, maxAbs) {
    const safeMax = Math.max(Math.abs(maxAbs), 1e-12);
    const t = Math.max(-1, Math.min(1, value / safeMax));
    const red = [220, 38, 38];
    const center = [241, 245, 249];
    const blue = [37, 99, 235];
    const start = t < 0 ? red : center;
    const end = t < 0 ? center : blue;
    const ratio = t < 0 ? t + 1 : t;
    const rgb = start.map((channel, index) =>
      Math.round(channel + (end[index] - channel) * ratio)
    );
    return `rgb(${rgb.join(',')})`;
  }

  function finiteCurvatureValues(collection) {
    return collection
      .map((element) => {
        const raw = element.data('curvature');
        return raw === null || raw === undefined ? NaN : Number(raw);
      })
      .filter((value) => Number.isFinite(value));
  }

  function updateCurvatureStats(values) {
    if (!values.length) {
      minEl.textContent = '—';
      maxEl.textContent = '—';
      return 1;
    }

    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    minEl.textContent = minValue.toFixed(3);
    maxEl.textContent = maxValue.toFixed(3);
    return Math.max(Math.abs(minValue), Math.abs(maxValue), 1e-12);
  }

  function applyEdgeCurvatureStyles() {
    const values = finiteCurvatureValues(cy.edges());
    const maxAbs = updateCurvatureStats(values);

    cy.edges().forEach((edge) => {
      const value = Number(edge.data('curvature'));
      if (!Number.isFinite(value)) return;
      edge.style({
        'line-color': curvatureColor(value, maxAbs),
        'label': value.toFixed(3),
        'font-size': 11,
        'color': '#334155',
        'text-background-color': '#ffffff',
        'text-background-opacity': 0.88,
        'text-background-padding': 3,
      });
    });
  }

  function applyNodeCurvatureStyles() {
    const values = finiteCurvatureValues(cy.nodes());
    const maxAbs = updateCurvatureStats(values);

    cy.nodes().forEach((node) => {
      const value = Number(node.data('curvature'));
      if (!Number.isFinite(value)) return;
      const baseLabel = String(node.data('label') ?? node.id());
      node.style({
        'background-color': curvatureColor(value, maxAbs),
        'label': `${baseLabel}\n${value.toFixed(3)}`,
        'text-wrap': 'wrap',
        'text-valign': 'bottom',
        'text-margin-y': 10,
      });
    });
  }

  function applyGraphCurvatureStyles() {
    // Graph-level methods do not colour nodes or edges. Their numerical range
    // is still shown in the statistics panel.
    const values = [];
    cy.nodes().forEach((node) => {
      const value = Number(node.data('curvature'));
      if (Number.isFinite(value)) values.push(value);
    });
    updateCurvatureStats(values);
  }

  function applyCurvatureStyles(target = selectedMethod().target) {
    resetCurvatureStyles();

    if (target === 'edges') {
      applyEdgeCurvatureStyles();
      return;
    }
    if (target === 'nodes') {
      applyNodeCurvatureStyles();
      return;
    }

    updateCurvatureStats([]);
  }

  function renderCurvatureResult(data) {
    const target = data.curvature?.target;
    const values = Array.isArray(data.values) ? data.values : [];

    clearCurvatureData();
    resetCurvatureStyles();

    if (target === 'edges') {
      values.forEach((item) => {
        const edge = cy.getElementById(String(item.id));
        if (edge.length) edge.data('curvature', Number(item.value));
      });
      applyEdgeCurvatureStyles();
      return;
    }

    if (target === 'nodes') {
      values.forEach((item) => {
        const node = cy.getElementById(String(item.id));
        if (node.length) node.data('curvature', Number(item.value));
      });
      applyNodeCurvatureStyles();
      return;
    }

    if (target === 'graph') {
      graphCurvatureValues = values
        .map((item) => ({ id: String(item.id), value: Number(item.value) }))
        .filter((item) => Number.isFinite(item.value));
      const numbers = graphCurvatureValues.map((item) => item.value);
      updateCurvatureStats(numbers);
      return;
    }

    throw new Error(`Unsupported curvature target: ${target}`);
  }

  async function computeCurvature() {
    const method = selectedMethod();

    if (method.target === 'edges' && !cy.edges().length) {
      setStatus(`${method.name} needs at least one edge.`, 'error');
      return;
    }
    if (method.target === 'nodes' && !cy.nodes().length) {
      setStatus(`${method.name} needs at least one vertex.`, 'error');
      return;
    }

    let parameters;
    try {
      parameters = readParameterControls();
      parameterState.set(method.id, parameters);
    } catch (error) {
      setStatus(error.message, 'error');
      return;
    }

    const payload = {
      curvature: method.id,
      parameters,
      nodes: cy.nodes().map((node) => ({ id: node.id() })),
      edges: cy.edges().map((edge) => ({
        id: edge.id(),
        source: edge.data('source'),
        target: edge.data('target'),
      })),
    };

    const requestedMethod = method.id;
    setStatus(`Computing ${method.name}…`);

    try {
      const response = await fetch('/api/curvature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || data.error || 'Unknown error');
      }

      if (selectedCurvature !== requestedMethod) {
        setStatus('The curvature type changed while the calculation was running; result ignored.');
        return;
      }

      renderCurvatureResult(data);
      syncJsonFromGraph();
      setStatus(`${method.name} updated.`, 'success');
    } catch (error) {
      setStatus(`Error: ${error.message}`, 'error');
    }
  }

  function graphAsObject() {
    const method = selectedMethod();
    let parameters = parameterState.get(method.id) || parameterDefaults(method);
    try {
      parameters = readParameterControls();
    } catch (_) {
      // Keep the last valid parameter state in exported JSON.
    }

    return {
      version: 2,
      curvature: {
        type: method.id,
        target: method.target,
        parameters,
        ...(method.target === 'graph' && graphCurvatureValues.length
          ? { values: graphCurvatureValues }
          : {}),
      },
      nodes: cy.nodes().map((node) => {
        const position = node.position();
        const result = {
          id: node.id(),
          label: String(node.data('label') ?? node.id()),
          position: {
            x: Number(position.x.toFixed(3)),
            y: Number(position.y.toFixed(3)),
          },
        };

        if (method.target === 'nodes') {
          const value = Number(node.data('curvature'));
          if (Number.isFinite(value)) result.curvature = value;
        }

        return result;
      }),
      edges: cy.edges().map((edge) => {
        const result = {
          id: edge.id(),
          source: String(edge.data('source')),
          target: String(edge.data('target')),
        };

        if (method.target === 'edges') {
          const value = Number(edge.data('curvature'));
          if (Number.isFinite(value)) result.curvature = value;
        }

        return result;
      }),
    };
  }

  function syncJsonFromGraph(force = false) {
    if (!force && document.activeElement === jsonTextarea && jsonDirty) {
      setJsonStatus('There are unapplied JSON edits. Press Ctrl+Enter to import them.');
      return;
    }

    jsonTextarea.value = JSON.stringify(graphAsObject(), null, 2);
    jsonDirty = false;
    setJsonStatus('JSON synchronized with the graph.');
  }

  function validateImport(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('The JSON root must be an object.');
    }
    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      throw new Error('The JSON must contain "nodes" and "edges" arrays.');
    }
    if (data.nodes.length > 200 || data.edges.length > 1000) {
      throw new Error('Maximum size: 200 vertices and 1000 edges.');
    }

    const nodeIds = new Set();
    for (const node of data.nodes) {
      if (!node || typeof node !== 'object') throw new Error('Every node must be an object.');
      const id = String(node.id ?? '').trim();
      if (!id) throw new Error('Every node needs an id.');
      if (nodeIds.has(id)) throw new Error(`Duplicate node: ${id}`);
      nodeIds.add(id);
    }

    const edgeIds = new Set();
    const pairs = new Set();
    for (const edge of data.edges) {
      if (!edge || typeof edge !== 'object') throw new Error('Every edge must be an object.');
      const id = String(edge.id ?? '').trim();
      const source = String(edge.source ?? '').trim();
      const target = String(edge.target ?? '').trim();
      if (!id) throw new Error('Every edge needs an id.');
      if (edgeIds.has(id)) throw new Error(`Duplicate edge: ${id}`);
      edgeIds.add(id);
      if (!nodeIds.has(source) || !nodeIds.has(target)) {
        throw new Error(`Edge ${id} references a missing node.`);
      }
      if (source === target) throw new Error(`Edge ${id} is a self-loop; self-loops are not supported.`);
      const pair = [source, target].sort().join('\u0000');
      if (pairs.has(pair)) throw new Error(`There is more than one edge between ${source} and ${target}.`);
      pairs.add(pair);
    }

    // Version 1 compatibility: old exports stored alpha at the root and had no
    // curvature metadata. They are interpreted as Ollivier-Ricci graphs.
    const methodId = String(data.curvature?.type ?? data.curvatureType ?? 'ollivier');
    const method = getMethod(methodId);
    if (!method) throw new Error(`Unknown curvature method: ${methodId}`);
    if (!method.available) throw new Error(`${method.name} is not implemented yet.`);

    const parameters = {
      ...(data.curvature?.parameters || {}),
    };
    if (data.alpha !== undefined && parameters.alpha === undefined) {
      parameters.alpha = data.alpha;
    }

    return {
      methodId,
      parameters: validateParameters(method, parameters),
    };
  }

  function loadGraphData(data, options = {}) {
    const {
      methodId = selectedCurvature,
      parameters = parameterState.get(methodId) || parameterDefaults(getMethod(methodId) || selectedMethod()),
      fit = true,
      statusMessage = 'Graph loaded.',
      jsonMessage = 'JSON synchronized with the graph.',
    } = options;

    const method = getMethod(methodId) || selectedMethod();

    gesture = null;
    endEdgePreview();
    endSelectionBox();
    cy.elements().remove();
    clearChosen();

    selectCurvature(method.id, {
      invalidate: false,
      parameters,
      syncJson: false,
      announce: false,
    });

    const hasAllPositions = data.nodes.every(
      (node) => Number.isFinite(Number(node.position?.x)) && Number.isFinite(Number(node.position?.y))
    );

    data.nodes.forEach((node, index) => {
      const position = hasAllPositions
        ? { x: Number(node.position.x), y: Number(node.position.y) }
        : { x: 180 + (index % 5) * 120, y: 150 + Math.floor(index / 5) * 110 };

      const elementData = {
        id: String(node.id),
        label: String(node.label ?? node.id),
      };

      if (method.target === 'nodes' && Number.isFinite(Number(node.curvature))) {
        elementData.curvature = Number(node.curvature);
      }

      cy.add({
        group: 'nodes',
        data: elementData,
        position,
        grabbable: false,
      });
    });

    data.edges.forEach((edge) => {
      const elementData = {
        id: String(edge.id),
        source: String(edge.source),
        target: String(edge.target),
      };

      if (method.target === 'edges' && Number.isFinite(Number(edge.curvature))) {
        elementData.curvature = Number(edge.curvature);
      }

      cy.add({
        group: 'edges',
        data: elementData,
      });
    });

    if (method.target === 'graph' && Array.isArray(data.curvature?.values)) {
      graphCurvatureValues = data.curvature.values
        .map((item) => ({ id: String(item.id), value: Number(item.value) }))
        .filter((item) => Number.isFinite(item.value));
    } else {
      graphCurvatureValues = [];
    }

    refreshCountersFromIds();
    updateCounts();
    if (method.target === 'graph') {
      updateCurvatureStats(graphCurvatureValues.map((item) => item.value));
      resetCurvatureStyles();
    } else {
      applyCurvatureStyles(method.target);
    }
    if (fit && cy.elements().length) cy.fit(undefined, 70);
    jsonDirty = false;
    syncJsonFromGraph(true);
    setJsonStatus(jsonMessage, 'success');
    setStatus(statusMessage, 'success');
  }

  function importJson() {
    try {
      const data = JSON.parse(jsonTextarea.value);
      const importOptions = validateImport(data);
      loadGraphData(data, {
        ...importOptions,
        statusMessage: 'Graph imported.',
        jsonMessage: 'JSON imported successfully.',
      });
    } catch (error) {
      setJsonStatus(`Could not import: ${error.message}`, 'error');
      setStatus(`Invalid JSON: ${error.message}`, 'error');
    }
  }

  function circlePositions(count, radius = 220, cx = 430, cyCenter = 330, offset = -Math.PI / 2) {
    return Array.from({ length: count }, (_, index) => {
      const angle = offset + (2 * Math.PI * index) / count;
      return {
        x: cx + radius * Math.cos(angle),
        y: cyCenter + radius * Math.sin(angle),
      };
    });
  }

  function graphFromPairs(nodeCount, pairs, positions = circlePositions(nodeCount)) {
    return {
      version: 2,
      nodes: Array.from({ length: nodeCount }, (_, index) => ({
        id: `v${index + 1}`,
        label: String(index + 1),
        position: positions[index],
      })),
      edges: pairs.map(([a, b], index) => ({
        id: `e${index + 1}`,
        source: `v${a}`,
        target: `v${b}`,
      })),
    };
  }

  function pathGraph(n) {
    const pairs = [];
    for (let i = 1; i < n; i += 1) pairs.push([i, i + 1]);
    const positions = Array.from({ length: n }, (_, i) => ({ x: 170 + i * 130, y: 330 }));
    return graphFromPairs(n, pairs, positions);
  }

  function cycleGraph(n) {
    const pairs = [];
    for (let i = 1; i <= n; i += 1) pairs.push([i, i === n ? 1 : i + 1]);
    return graphFromPairs(n, pairs);
  }

  function completeGraph(n) {
    const pairs = [];
    for (let i = 1; i <= n; i += 1) {
      for (let j = i + 1; j <= n; j += 1) pairs.push([i, j]);
    }
    return graphFromPairs(n, pairs);
  }

  function starGraph(leaves) {
    const nodeCount = leaves + 1;
    const positions = [{ x: 430, y: 330 }, ...circlePositions(leaves, 225)];
    const pairs = [];
    for (let i = 2; i <= nodeCount; i += 1) pairs.push([1, i]);
    return graphFromPairs(nodeCount, pairs, positions);
  }

  function wheelGraph(totalNodes) {
    const rim = totalNodes - 1;
    const positions = [{ x: 430, y: 330 }, ...circlePositions(rim, 225)];
    const pairs = [];
    for (let i = 2; i <= totalNodes; i += 1) {
      pairs.push([1, i]);
      pairs.push([i, i === totalNodes ? 2 : i + 1]);
    }
    return graphFromPairs(totalNodes, pairs, positions);
  }

  function completeBipartiteGraph(leftCount, rightCount) {
    const nodeCount = leftCount + rightCount;
    const positions = [];
    const leftGap = 420 / Math.max(1, leftCount - 1);
    const rightGap = 420 / Math.max(1, rightCount - 1);

    for (let i = 0; i < leftCount; i += 1) {
      positions.push({ x: 260, y: leftCount === 1 ? 330 : 120 + i * leftGap });
    }
    for (let j = 0; j < rightCount; j += 1) {
      positions.push({ x: 600, y: rightCount === 1 ? 330 : 120 + j * rightGap });
    }

    const pairs = [];
    for (let i = 1; i <= leftCount; i += 1) {
      for (let j = 1; j <= rightCount; j += 1) pairs.push([i, leftCount + j]);
    }
    return graphFromPairs(nodeCount, pairs, positions);
  }

  function cubeGraph() {
    const positions = [
      { x: 230, y: 130 }, { x: 610, y: 130 }, { x: 610, y: 510 }, { x: 230, y: 510 },
      { x: 330, y: 230 }, { x: 510, y: 230 }, { x: 510, y: 410 }, { x: 330, y: 410 },
    ];
    const pairs = [
      [1, 2], [2, 3], [3, 4], [4, 1],
      [5, 6], [6, 7], [7, 8], [8, 5],
      [1, 5], [2, 6], [3, 7], [4, 8],
    ];
    return graphFromPairs(8, pairs, positions);
  }

  function petersenGraph() {
    const outer = circlePositions(5, 235);
    const inner = circlePositions(5, 100);
    const positions = [...outer, ...inner];
    const pairs = [];

    for (let i = 1; i <= 5; i += 1) {
      pairs.push([i, i === 5 ? 1 : i + 1]);
      pairs.push([i, i + 5]);
    }

    pairs.push([6, 8], [8, 10], [10, 7], [7, 9], [9, 6]);
    return graphFromPairs(10, pairs, positions);
  }

  function octahedralGraph() {
    const opposite = new Set(['1-4', '2-5', '3-6']);
    const pairs = [];
    for (let i = 1; i <= 6; i += 1) {
      for (let j = i + 1; j <= 6; j += 1) {
        if (!opposite.has(`${i}-${j}`)) pairs.push([i, j]);
      }
    }
    return graphFromPairs(6, pairs);
  }

  function triangularPrismGraph() {
    const positions = [
      { x: 250, y: 160 }, { x: 170, y: 460 }, { x: 330, y: 460 },
      { x: 610, y: 160 }, { x: 530, y: 460 }, { x: 690, y: 460 },
    ];
    const pairs = [
      [1, 2], [2, 3], [3, 1],
      [4, 5], [5, 6], [6, 4],
      [1, 4], [2, 5], [3, 6],
    ];
    return graphFromPairs(6, pairs, positions);
  }

  const PRESETS = [
    { id: 'path5', name: 'Path P₅', detail: '5 vertices · 4 edges', build: () => pathGraph(5) },
    { id: 'cycle6', name: 'Cycle C₆', detail: '6 vertices · 6 edges', build: () => cycleGraph(6) },
    { id: 'complete4', name: 'Complete K₄', detail: '4 vertices · 6 edges', build: () => completeGraph(4) },
    { id: 'complete5', name: 'Complete K₅', detail: '5 vertices · 10 edges', build: () => completeGraph(5) },
    { id: 'star5', name: 'Star K₁,₅', detail: '6 vertices · 5 edges', build: () => starGraph(5) },
    { id: 'wheel7', name: 'Wheel W₇', detail: '7 vertices · 12 edges', build: () => wheelGraph(7) },
    { id: 'k33', name: 'Bipartite K₃,₃', detail: '6 vertices · 9 edges', build: () => completeBipartiteGraph(3, 3) },
    { id: 'cube', name: 'Cube Q₃', detail: '8 vertices · 12 edges', build: cubeGraph },
    { id: 'petersen', name: 'Petersen graph', detail: '10 vertices · 15 edges', build: petersenGraph },
    { id: 'octahedral', name: 'Octahedral graph', detail: '6 vertices · 12 edges', build: octahedralGraph },
    { id: 'prism', name: 'Triangular prism', detail: '6 vertices · 9 edges', build: triangularPrismGraph },
  ];

  function loadPreset(preset) {
    const method = selectedMethod();
    let parameters = parameterState.get(method.id) || parameterDefaults(method);
    try {
      parameters = readParameterControls();
    } catch (_) {
      // Keep last valid values.
    }

    loadGraphData(preset.build(), {
      methodId: method.id,
      parameters,
      statusMessage: `${preset.name} loaded. Press R to compute ${method.short_name || method.name}.`,
      jsonMessage: `JSON updated for ${preset.name}.`,
    });
  }

  function renderPresetCollection() {
    PRESETS.forEach((preset) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'preset-card';
      button.dataset.preset = preset.id;
      button.innerHTML = `<strong>${preset.name}</strong><span>${preset.detail}</span>`;
      button.addEventListener('click', () => loadPreset(preset));
      presetListEl.appendChild(button);
    });
  }

  function beginEdgePreview(sourceNode, renderedPoint) {
    const sourcePosition = sourceNode.renderedPosition();
    edgePreview.removeAttribute('hidden');
    edgePreviewLine.setAttribute('x1', String(sourcePosition.x));
    edgePreviewLine.setAttribute('y1', String(sourcePosition.y));
    edgePreviewLine.setAttribute('x2', String(renderedPoint.x));
    edgePreviewLine.setAttribute('y2', String(renderedPoint.y));
  }

  function updateEdgePreview(renderedPoint) {
    edgePreviewLine.setAttribute('x2', String(renderedPoint.x));
    edgePreviewLine.setAttribute('y2', String(renderedPoint.y));
  }

  function endEdgePreview() {
    edgePreview.setAttribute('hidden', '');
    edgePreviewLine.setAttribute('x1', '0');
    edgePreviewLine.setAttribute('y1', '0');
    edgePreviewLine.setAttribute('x2', '0');
    edgePreviewLine.setAttribute('y2', '0');
  }

  function beginSelectionBox(start) {
    selectionBox.hidden = false;
    selectionBox.style.left = `${start.x}px`;
    selectionBox.style.top = `${start.y}px`;
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
  }

  function updateSelectionBox(start, current) {
    const left = Math.min(start.x, current.x);
    const top = Math.min(start.y, current.y);
    const width = Math.abs(current.x - start.x);
    const height = Math.abs(current.y - start.y);
    selectionBox.style.left = `${left}px`;
    selectionBox.style.top = `${top}px`;
    selectionBox.style.width = `${width}px`;
    selectionBox.style.height = `${height}px`;
  }

  function endSelectionBox() {
    selectionBox.hidden = true;
  }

  function selectInBox(start, end, additive) {
    const rect = {
      left: Math.min(start.x, end.x),
      right: Math.max(start.x, end.x),
      top: Math.min(start.y, end.y),
      bottom: Math.max(start.y, end.y),
    };

    if (!additive) clearChosen();

    const inside = (point) =>
      point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;

    cy.nodes().forEach((node) => {
      if (inside(node.renderedPosition())) {
        node.addClass('chosen');
        node.grabify();
      }
    });

    cy.edges().forEach((edge) => {
      const s = edge.source().renderedPosition();
      const t = edge.target().renderedPosition();
      const midpoint = { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };
      if (inside(midpoint) || (inside(s) && inside(t))) edge.addClass('chosen');
    });

    const count = cy.$('.chosen').length;
    setStatus(`${count} element${count === 1 ? '' : 's'} selected.`);
  }

  cyContainer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const point = localPointerPosition(event);
    const hit = elementAt(point);

    if (hit && hit.isNode()) {
      if (hit.hasClass('chosen')) {
        // Selected nodes are grabbable, so Cytoscape handles moving them.
        gesture = null;
        return;
      }

      gesture = {
        type: 'edge',
        pointerId: event.pointerId,
        sourceId: hit.id(),
        start: point,
        current: point,
        moved: false,
      };
      return;
    }

    if (hit && hit.isEdge()) {
      gesture = null;
      return;
    }

    gesture = {
      type: 'background',
      pointerId: event.pointerId,
      start: point,
      current: point,
      moved: false,
      additive: event.ctrlKey || event.metaKey || event.shiftKey,
    };
  });

  window.addEventListener('pointermove', (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const point = localPointerPosition(event);
    gesture.current = point;
    const distance = Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y);

    if (distance >= DRAG_THRESHOLD) gesture.moved = true;

    if (gesture.type === 'edge' && gesture.moved) {
      if (edgePreview.hasAttribute('hidden')) {
        const sourceNode = cy.getElementById(gesture.sourceId);
        if (sourceNode.length) beginEdgePreview(sourceNode, point);
      }
      updateEdgePreview(point);
      event.preventDefault();
    }

    if (gesture.type === 'background' && gesture.moved) {
      if (selectionBox.hidden) beginSelectionBox(gesture.start);
      updateSelectionBox(gesture.start, point);
      event.preventDefault();
    }
  }, { passive: false });

  window.addEventListener('pointerup', (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const finished = gesture;
    const point = localPointerPosition(event);
    gesture = null;

    if (finished.type === 'edge') {
      endEdgePreview();
      if (!finished.moved) return;
      const targetNode = hitTestNode(point, finished.sourceId);
      if (!targetNode) {
        setStatus('Drag onto another vertex to create an edge.', 'error');
        return;
      }
      addEdge(finished.sourceId, targetNode.id());
      return;
    }

    if (finished.type === 'background') {
      endSelectionBox();
      if (finished.moved) {
        selectInBox(finished.start, point, finished.additive);
      } else {
        addNodeAtRendered(point);
      }
    }
  });

  window.addEventListener('pointercancel', () => {
    gesture = null;
    endEdgePreview();
    endSelectionBox();
  });

  cy.on('tap', 'node, edge', (event) => {
    const target = event.target;
    const now = performance.now();
    const group = target.isNode() ? 'node' : 'edge';
    const same = lastElementTap.id === target.id() && lastElementTap.group === group;

    if (same && now - lastElementTap.time <= DOUBLE_CLICK_MS) {
      const original = event.originalEvent || {};
      const additive = Boolean(original.ctrlKey || original.metaKey || original.shiftKey);
      toggleChosen(target, additive);
      const selectedCount = cy.$('.chosen').length;
      if (target.isNode() && target.hasClass('chosen')) {
        setStatus(`Vertex ${target.id()} selected and enabled for moving. Selected: ${selectedCount}.`);
      } else {
        setStatus(`${selectedCount} element${selectedCount === 1 ? '' : 's'} selected.`);
      }
      lastElementTap = { id: null, group: null, time: 0 };
      return;
    }

    lastElementTap = { id: target.id(), group, time: now };
  });

  cy.on('free', 'node', () => {
    syncJsonFromGraph();
    setStatus('Position updated. Moving vertices does not change graph curvature.');
  });

  jsonTextarea.addEventListener('input', () => {
    jsonDirty = true;
    setJsonStatus('JSON edited. Press Ctrl+Enter to import it.');
  });

  jsonTextarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      importJson();
    }
  });

  document.addEventListener('keydown', (event) => {
    const active = document.activeElement;
    const editing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
    if (editing) return;

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteChosen();
      return;
    }

    if (event.key === 'Escape') {
      if (!curvatureMenu.hidden) {
        closeCurvatureMenu();
        curvatureTitle.focus();
        return;
      }
      clearChosen();
      setStatus('Selection cleared.');
      return;
    }

    if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      computeCurvature();
    }
  });

  cy.on('add remove', updateCounts);

  async function initialize() {
    renderPresetCollection();
    updateCounts();
    await loadCurvatureCatalog();
    syncJsonFromGraph(true);
    setStatus('Click the canvas to create a vertex, or load a known graph from the collection.');
  }

  initialize().catch((error) => {
    setStatus(`Initialization error: ${error.message}`, 'error');
  });
})();
