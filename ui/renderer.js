const api = window.plannotateAPI;

const elements = {
  dbStatus: document.getElementById("dbStatus"),
  setupDbBtn: document.getElementById("setupDbBtn"),
  importDbArchiveBtn: document.getElementById("importDbArchiveBtn"),
  importDbFolderBtn: document.getElementById("importDbFolderBtn"),
  modeFile: document.getElementById("modeFile"),
  modeText: document.getElementById("modeText"),
  fileInputPanel: document.getElementById("fileInputPanel"),
  textInputPanel: document.getElementById("textInputPanel"),
  pickFileBtn: document.getElementById("pickFileBtn"),
  pickedFile: document.getElementById("pickedFile"),
  sequenceInput: document.getElementById("sequenceInput"),
  linearOption: document.getElementById("linearOption"),
  detailedOption: document.getElementById("detailedOption"),
  annotateBtn: document.getElementById("annotateBtn"),
  runStatus: document.getElementById("runStatus"),
  exportGbkBtn: document.getElementById("exportGbkBtn"),
  exportCsvBtn: document.getElementById("exportCsvBtn"),
  mapContainer: document.getElementById("mapContainer"),
  mapMeta: document.getElementById("mapMeta"),
  hitCount: document.getElementById("hitCount"),
  resultsTableBody: document.querySelector("#resultsTable tbody")
};

const state = {
  mode: "file",
  filePath: null,
  hasResult: false
};

function setRunStatus(message, isError = false) {
  elements.runStatus.textContent = message;
  elements.runStatus.style.color = isError ? "#8d3f28" : "";
}

function setDbStatus(exists) {
  if (exists) {
    elements.dbStatus.textContent = "BLAST databases are available.";
    elements.dbStatus.dataset.status = "ok";
  } else {
    elements.dbStatus.textContent = "BLAST databases are missing. Run Setup Databases or import locally.";
    elements.dbStatus.dataset.status = "missing";
  }
}

function setMode(mode) {
  state.mode = mode;

  const isFile = mode === "file";
  elements.modeFile.classList.toggle("active", isFile);
  elements.modeText.classList.toggle("active", !isFile);
  elements.fileInputPanel.classList.toggle("active", isFile);
  elements.textInputPanel.classList.toggle("active", !isFile);
}

function setBusy(isBusy) {
  elements.annotateBtn.disabled = isBusy;
  elements.pickFileBtn.disabled = isBusy;
  elements.modeFile.disabled = isBusy;
  elements.modeText.disabled = isBusy;
  elements.setupDbBtn.disabled = isBusy;
  elements.importDbArchiveBtn.disabled = isBusy;
  elements.importDbFolderBtn.disabled = isBusy;
}

function hasApi() {
  return Boolean(api);
}

function polar(angle, radius) {
  const theta = (Math.PI / 2) - angle;
  return {
    x: radius * Math.cos(theta),
    y: radius * Math.sin(theta)
  };
}

function arcPath(startAngle, endAngle, radius) {
  let span = endAngle - startAngle;
  if (span <= 0) {
    span += Math.PI * 2;
  }
  if (span >= Math.PI * 2) {
    span = (Math.PI * 2) - 1e-4;
    endAngle = startAngle + span;
  }

  const start = polar(startAngle, radius);
  const end = polar(endAngle, radius);
  const largeArc = span > Math.PI ? 1 : 0;

  return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${radius.toFixed(3)} ${radius.toFixed(3)} 0 ${largeArc} 0 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
}

function trianglePoints(tip, direction, size = 9, width = 5) {
  const mag = Math.hypot(direction.x, direction.y) || 1;
  const ux = direction.x / mag;
  const uy = direction.y / mag;
  const nx = -uy;
  const ny = ux;

  const bx = tip.x - (ux * size);
  const by = tip.y - (uy * size);

  const left = { x: bx + (nx * width), y: by + (ny * width) };
  const right = { x: bx - (nx * width), y: by - (ny * width) };

  return `${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`;
}

const MAP_GEOMETRY = {
  viewSize: 1200,
  backboneRadius: 210,
  tickInner: 190,
  tickOuter: 210,
  tickLabel: 176,
  featureBase: 240,
  featureStep: 22,
  featureThickness: 15,
  featureConnector: 30,
  featureLabel: 50
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatFeatureTooltip(feature) {
  const identity = feature.db === "Rfam" ? "-" : `${Number(feature.scoreLabel.replace("%", "") || 0).toFixed(0)}%`;
  const description = feature.description && String(feature.description).trim()
    ? feature.description
    : "No description";

  return `<strong>${feature.feature}</strong><br>${feature.type} | ${feature.db} | ${identity}<br>${description}`;
}

function placeTooltip(tooltip, container, event) {
  const containerRect = container.getBoundingClientRect();
  const localX = event.clientX - containerRect.left;
  const localY = event.clientY - containerRect.top;

  const tipWidth = tooltip.offsetWidth || 280;
  const tipHeight = tooltip.offsetHeight || 64;

  const left = clamp(localX + 12, 8, containerRect.width - tipWidth - 8);
  const top = clamp(localY + 12, 8, containerRect.height - tipHeight - 8);

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function enablePanZoom(svg, sceneGroup) {
  const viewSize = MAP_GEOMETRY.viewSize;
  const statePanZoom = {
    scale: 1.15,
    tx: 0,
    ty: 0,
    dragging: false,
    pointerId: null,
    lastX: 0,
    lastY: 0
  };

  function applyTransform() {
    sceneGroup.setAttribute(
      "transform",
      `translate(${statePanZoom.tx.toFixed(3)} ${statePanZoom.ty.toFixed(3)}) scale(${statePanZoom.scale.toFixed(4)})`
    );
  }

  function unitsPerPixel() {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) {
      return 1;
    }
    return viewSize / rect.width;
  }

  svg.style.cursor = "grab";
  applyTransform();

  svg.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    statePanZoom.dragging = true;
    statePanZoom.pointerId = event.pointerId;
    statePanZoom.lastX = event.clientX;
    statePanZoom.lastY = event.clientY;
    svg.setPointerCapture(event.pointerId);
    svg.style.cursor = "grabbing";
  });

  svg.addEventListener("pointermove", (event) => {
    if (!statePanZoom.dragging) {
      return;
    }
    const step = unitsPerPixel();
    const dx = (event.clientX - statePanZoom.lastX) * step;
    const dy = (event.clientY - statePanZoom.lastY) * step;

    statePanZoom.tx += dx;
    statePanZoom.ty += dy;
    statePanZoom.lastX = event.clientX;
    statePanZoom.lastY = event.clientY;
    applyTransform();
  });

  function stopDragging(pointerId) {
    if (pointerId !== null && svg.hasPointerCapture(pointerId)) {
      svg.releasePointerCapture(pointerId);
    }
    statePanZoom.dragging = false;
    statePanZoom.pointerId = null;
    svg.style.cursor = "grab";
  }

  svg.addEventListener("pointerup", () => stopDragging(statePanZoom.pointerId));
  svg.addEventListener("pointercancel", () => stopDragging(statePanZoom.pointerId));
  svg.addEventListener("pointerleave", () => {
    if (!statePanZoom.dragging) {
      svg.style.cursor = "grab";
    }
  });

  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }

    const vx = (((event.clientX - rect.left) / rect.width) * viewSize) - (viewSize / 2);
    const vy = (((event.clientY - rect.top) / rect.height) * viewSize) - (viewSize / 2);

    const worldX = (vx - statePanZoom.tx) / statePanZoom.scale;
    const worldY = (vy - statePanZoom.ty) / statePanZoom.scale;

    const zoomFactor = Math.exp(-event.deltaY * 0.0015);
    const nextScale = clamp(statePanZoom.scale * zoomFactor, 0.45, 4.5);

    statePanZoom.tx = vx - (worldX * nextScale);
    statePanZoom.ty = vy - (worldY * nextScale);
    statePanZoom.scale = nextScale;
    applyTransform();
  }, { passive: false });

  svg.addEventListener("dblclick", () => {
    statePanZoom.scale = 1.15;
    statePanZoom.tx = 0;
    statePanZoom.ty = 0;
    applyTransform();
  });
}

function renderMap(mapModel) {
  elements.mapContainer.innerHTML = "";

  if (!mapModel || !mapModel.sequenceLength) {
    const empty = document.createElement("div");
    empty.className = "map-empty";
    empty.textContent = "Run annotation to display the plasmid map.";
    elements.mapContainer.appendChild(empty);
    elements.mapMeta.textContent = "";
    return;
  }

  elements.mapMeta.textContent = `${mapModel.sequenceLength.toLocaleString()} bp`;

  const svgNS = "http://www.w3.org/2000/svg";
  const halfView = MAP_GEOMETRY.viewSize / 2;
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "map-svg");
  svg.setAttribute("viewBox", `${-halfView} ${-halfView} ${MAP_GEOMETRY.viewSize} ${MAP_GEOMETRY.viewSize}`);

  const scene = document.createElementNS(svgNS, "g");
  svg.appendChild(scene);

  const tooltip = document.createElement("div");
  tooltip.className = "map-tooltip";
  elements.mapContainer.appendChild(tooltip);

  const backbone = document.createElementNS(svgNS, "circle");
  backbone.setAttribute("cx", "0");
  backbone.setAttribute("cy", "0");
  backbone.setAttribute("r", String(MAP_GEOMETRY.backboneRadius));
  backbone.setAttribute("fill", "none");
  backbone.setAttribute("stroke", "#111");
  backbone.setAttribute("stroke-width", "4");
  scene.appendChild(backbone);

  for (const tick of mapModel.ticks ?? []) {
    const inner = polar(tick.angle, MAP_GEOMETRY.tickInner);
    const outer = polar(tick.angle, MAP_GEOMETRY.tickOuter);
    const textPoint = polar(tick.angle, MAP_GEOMETRY.tickLabel);

    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", inner.x);
    line.setAttribute("y1", inner.y);
    line.setAttribute("x2", outer.x);
    line.setAttribute("y2", outer.y);
    line.setAttribute("stroke", "#262626");
    line.setAttribute("stroke-width", "2");
    line.setAttribute("opacity", "0.45");
    scene.appendChild(line);

    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", textPoint.x);
    label.setAttribute("y", textPoint.y);
    label.setAttribute("font-size", "12");
    label.setAttribute("fill", "#565656");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "middle");
    label.textContent = String(tick.bp);
    scene.appendChild(label);
  }

  const sorted = [...mapModel.features].sort((a, b) => a.level - b.level);

  for (const feature of sorted) {
    const radius = MAP_GEOMETRY.featureBase + (feature.level * MAP_GEOMETRY.featureStep);
    const thickness = MAP_GEOMETRY.featureThickness;

    const base = document.createElementNS(svgNS, "path");
    base.setAttribute("d", arcPath(feature.rstart, feature.rend, radius));
    base.setAttribute("fill", "none");
    base.setAttribute("stroke", feature.fillColor);
    base.setAttribute("stroke-width", thickness);
    base.setAttribute("stroke-linecap", "round");
    base.setAttribute("opacity", "0.94");

    const border = document.createElementNS(svgNS, "path");
    border.setAttribute("d", arcPath(feature.rstart, feature.rend, radius));
    border.setAttribute("fill", "none");
    border.setAttribute("stroke", feature.lineColor);
    border.setAttribute("stroke-width", "2");
    border.setAttribute("opacity", "0.95");

    const title = document.createElementNS(svgNS, "title");
    title.textContent = `${feature.feature} | ${feature.type} | ${feature.scoreLabel}`;
    base.appendChild(title);

    scene.appendChild(base);
    scene.appendChild(border);

    const interactiveShapes = [base, border];
    let arrow = null;

    if (feature.hasOrientation) {
      const arrowAngle = feature.strand >= 0 ? feature.rend : feature.rstart;
      const tip = polar(arrowAngle, radius);
      const prev = polar(arrowAngle - 0.04, radius);
      const next = polar(arrowAngle + 0.04, radius);
      const direction = feature.strand >= 0
        ? { x: next.x - prev.x, y: next.y - prev.y }
        : { x: prev.x - next.x, y: prev.y - next.y };

      arrow = document.createElementNS(svgNS, "polygon");
      arrow.setAttribute("points", trianglePoints(tip, direction));
      arrow.setAttribute("fill", feature.lineColor);
      scene.appendChild(arrow);
      interactiveShapes.push(arrow);
    }

    if (feature.level < 3) {
      const mid = (feature.rstart + feature.rend) / 2;
      const from = polar(mid, radius + (thickness / 2));
      const to = polar(mid, radius + MAP_GEOMETRY.featureConnector);
      const labelPos = polar(mid, radius + MAP_GEOMETRY.featureLabel);

      const connector = document.createElementNS(svgNS, "line");
      connector.setAttribute("x1", from.x);
      connector.setAttribute("y1", from.y);
      connector.setAttribute("x2", to.x);
      connector.setAttribute("y2", to.y);
      connector.setAttribute("stroke", feature.lineColor);
      connector.setAttribute("stroke-width", "1");
      connector.setAttribute("opacity", "0.6");
      scene.appendChild(connector);

      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", labelPos.x);
      text.setAttribute("y", labelPos.y);
      text.setAttribute("font-size", "12");
      text.setAttribute("fill", "#1f2630");
      text.setAttribute("dominant-baseline", "middle");
      text.setAttribute("text-anchor", labelPos.x >= 0 ? "start" : "end");
      text.textContent = feature.feature;
      scene.appendChild(text);
    }

    const hoverContent = formatFeatureTooltip(feature);
    for (const shape of interactiveShapes) {
      shape.addEventListener("pointerenter", (event) => {
        base.setAttribute("stroke-width", String(thickness + 3));
        border.setAttribute("stroke-width", "3.5");
        tooltip.innerHTML = hoverContent;
        tooltip.style.opacity = "1";
        placeTooltip(tooltip, elements.mapContainer, event);
      });

      shape.addEventListener("pointermove", (event) => {
        placeTooltip(tooltip, elements.mapContainer, event);
      });

      shape.addEventListener("pointerleave", () => {
        base.setAttribute("stroke-width", String(thickness));
        border.setAttribute("stroke-width", "2");
        tooltip.style.opacity = "0";
      });
    }
  }

  const center = document.createElementNS(svgNS, "text");
  center.setAttribute("x", "0");
  center.setAttribute("y", "0");
  center.setAttribute("text-anchor", "middle");
  center.setAttribute("dominant-baseline", "middle");
  center.setAttribute("font-size", "28");
  center.setAttribute("fill", "#5d6d7a");
  center.textContent = `${mapModel.sequenceLength} bp`;
  scene.appendChild(center);

  elements.mapContainer.appendChild(svg);
  enablePanZoom(svg, scene);
}

function renderTable(hits) {
  elements.resultsTableBody.innerHTML = "";

  for (const hit of hits) {
    const tr = document.createElement("tr");

    const identity = hit.db === "Rfam" ? "-" : `${Number(hit.pident).toFixed(1)}%`;
    const match = hit.db === "Rfam" ? "-" : `${Number(hit["abs percmatch"]).toFixed(1)}%`;

    const values = [
      hit.Feature,
      hit.Type,
      identity,
      match,
      hit.db,
      hit.Description
    ];

    for (const value of values) {
      const td = document.createElement("td");
      td.textContent = value ?? "";
      tr.appendChild(td);
    }

    elements.resultsTableBody.appendChild(tr);
  }

  elements.hitCount.textContent = `${hits.length} hits`;
}

function setExportEnabled(enabled) {
  elements.exportGbkBtn.disabled = !enabled;
  elements.exportCsvBtn.disabled = !enabled;
}

async function refreshDbStatus() {
  if (!hasApi()) {
    setDbStatus(false);
    setRunStatus("Preload bridge not available. Launch via Electron (npm start).", true);
    return;
  }

  try {
    const status = await api.checkDatabases();
    setDbStatus(Boolean(status.exists));
  } catch (error) {
    setDbStatus(false);
    setRunStatus(error.message, true);
  }
}

async function runAnnotation() {
  if (!hasApi()) {
    setRunStatus("Preload bridge not available. Launch via Electron (npm start).", true);
    return;
  }

  setBusy(true);
  setRunStatus("Running annotation...");

  try {
    const linear = elements.linearOption.checked;
    const detailed = elements.detailedOption.checked;
    let response;

    if (state.mode === "file") {
      if (!state.filePath) {
        throw new Error("Choose a FASTA or GenBank file first.");
      }

      response = await api.annotateFile({
        filePath: state.filePath,
        linear,
        detailed
      });
    } else {
      const sequenceText = elements.sequenceInput.value;
      if (!sequenceText.trim()) {
        throw new Error("Paste a DNA sequence first.");
      }

      response = await api.annotateText({
        sequenceText,
        linear,
        detailed,
        name: "plasmid"
      });
    }

    const result = response.result;
    state.hasResult = true;
    renderMap(result.map);
    renderTable(result.hits);
    setExportEnabled(true);
    setRunStatus(`Completed. ${result.hits.length} features found.`);
  } catch (error) {
    state.hasResult = false;
    setExportEnabled(false);
    setRunStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function pickFile() {
  if (!hasApi()) {
    setRunStatus("Preload bridge not available. Launch via Electron (npm start).", true);
    return;
  }

  const selected = await api.pickInputFile();
  if (selected.canceled) {
    return;
  }
  state.filePath = selected.filePath;
  elements.pickedFile.textContent = selected.filePath;
}

async function setupDatabases() {
  if (!hasApi()) {
    setRunStatus("Preload bridge not available. Launch via Electron (npm start).", true);
    return;
  }

  setBusy(true);
  setRunStatus("Setting up BLAST databases...");
  try {
    const response = await api.setupDatabases();
    await refreshDbStatus();
    const source = response?.result?.source ?? "download";
    if (source === "existing") {
      setRunStatus("Databases already available.");
    } else if (source === "local") {
      setRunStatus(`Database setup complete from local path: ${response.result.path}`);
    } else {
      setRunStatus("Database setup complete.");
    }
  } catch (error) {
    setRunStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function importDatabaseArchive() {
  if (!hasApi()) {
    setRunStatus("Preload bridge not available. Launch via Electron (npm start).", true);
    return;
  }

  setBusy(true);
  setRunStatus("Importing BLAST databases from archive...");
  try {
    const result = await api.importDatabaseArchive();
    if (result.canceled) {
      setRunStatus("Archive import canceled.");
      return;
    }
    await refreshDbStatus();
    setRunStatus("Database import complete.");
  } catch (error) {
    setRunStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function importDatabaseFolder() {
  if (!hasApi()) {
    setRunStatus("Preload bridge not available. Launch via Electron (npm start).", true);
    return;
  }

  setBusy(true);
  setRunStatus("Importing BLAST databases from folder...");
  try {
    const result = await api.importDatabaseFolder();
    if (result.canceled) {
      setRunStatus("Folder import canceled.");
      return;
    }
    await refreshDbStatus();
    setRunStatus("Database import complete.");
  } catch (error) {
    setRunStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function exportCsv() {
  if (!hasApi()) {
    setRunStatus("Preload bridge not available. Launch via Electron (npm start).", true);
    return;
  }

  try {
    const result = await api.exportCsv();
    if (!result.canceled) {
      setRunStatus(`CSV saved: ${result.filePath}`);
    }
  } catch (error) {
    setRunStatus(error.message, true);
  }
}

async function exportGbk() {
  if (!hasApi()) {
    setRunStatus("Preload bridge not available. Launch via Electron (npm start).", true);
    return;
  }

  try {
    const result = await api.exportGbk();
    if (!result.canceled) {
      setRunStatus(`GenBank saved: ${result.filePath}`);
    }
  } catch (error) {
    setRunStatus(error.message, true);
  }
}

function attachEvents() {
  elements.modeFile.addEventListener("click", () => setMode("file"));
  elements.modeText.addEventListener("click", () => setMode("text"));

  elements.pickFileBtn.addEventListener("click", pickFile);
  elements.setupDbBtn.addEventListener("click", setupDatabases);
  elements.importDbArchiveBtn.addEventListener("click", importDatabaseArchive);
  elements.importDbFolderBtn.addEventListener("click", importDatabaseFolder);
  elements.annotateBtn.addEventListener("click", runAnnotation);

  elements.exportCsvBtn.addEventListener("click", exportCsv);
  elements.exportGbkBtn.addEventListener("click", exportGbk);
}

async function initialize() {
  attachEvents();
  renderMap(null);
  setExportEnabled(false);
  await refreshDbStatus();
  setRunStatus("Idle");
}

initialize();
