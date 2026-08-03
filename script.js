let worker = null;
let availableWords = new Set();
let isGraphLoaded = false;
let longTaskTimer = null;
let lastRenderedPaths = [];

let renderedNodes = [];
let hoveredNode = null;

let lastSearch = { src: "", tgt: "" };

function initWorker() {
  // Pass the dedicated Web Worker file directly
  worker = new Worker("worker.js");

  worker.onmessage = function (e) {
    const { action, payload } = e.data;

    if (action === "GRAPH_PARSED") {
      availableWords = new Set(payload.wordList);
      isGraphLoaded = true;
      validateInputs();
      solveAndDraw();
    } else if (action === "PATHS_FOUND") {
      const { distance, paths } = payload;
      document.getElementById("distVal").innerText = distance;
      document.getElementById("pathsVal").innerText = paths.length;

      lastRenderedPaths = paths;
      renderGraph(paths);
      hideLoader();
    }
  };
}

function showLoader(text = "Calculating Paths...") {
  document.getElementById("loaderText").innerText = text;
  document.getElementById("loader").classList.add("active");

  clearTimeout(longTaskTimer);
  longTaskTimer = setTimeout(() => {
    document.getElementById("loaderText").innerText =
      "This search is taking longer than expected... hang tight!";
  }, 1500);
}

function hideLoader() {
  clearTimeout(longTaskTimer);
  document.getElementById("loader").classList.remove("active");
}

async function loadGraphFromFile() {
  showLoader("Loading connections.txt...");
  try {
    const response = await fetch("edges.csv");
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const textData = await response.text();
    worker.postMessage({ action: "PARSE_GRAPH", payload: textData });
  } catch (err) {
    console.error("Failed to load connections.txt file:", err);
    document.getElementById("distVal").innerText =
      "Error loading connections.txt";
    hideLoader();
  }
}

function validateInputs() {
  if (!isGraphLoaded) return false;

  const srcInput = document.getElementById("sourceWord");
  const tgtInput = document.getElementById("targetWord");
  const btn = document.getElementById("findBtn");
  const errorMsg = document.getElementById("errorMsg");

  const src = srcInput.value.trim().toLowerCase();
  const tgt = tgtInput.value.trim().toLowerCase();

  let isValid = true;
  let errors = [];

  srcInput.classList.remove("invalid");
  tgtInput.classList.remove("invalid");

  if (!src || !availableWords.has(src)) {
    srcInput.classList.add("invalid");
    errors.push(`"${src || "Source"}" is not in graph`);
    isValid = false;
  }

  if (!tgt || !availableWords.has(tgt)) {
    tgtInput.classList.add("invalid");
    errors.push(`"${tgt || "Target"}" is not in graph`);
    isValid = false;
  }

  if (!isValid) {
    btn.disabled = true;
    errorMsg.innerText = errors.join(" | ");
  } else {
    btn.disabled = false;
    errorMsg.innerText = "";
  }

  return isValid;
}

function handleKeyDown(event) {
  if (event.key === "Enter") {
    solveAndDraw();
  }
}

function swapWords() {
  const srcInput = document.getElementById("sourceWord");
  const tgtInput = document.getElementById("targetWord");

  // 1. Swap input values in the UI
  const temp = srcInput.value;
  srcInput.value = tgtInput.value;
  tgtInput.value = temp;

  // 2. Validate the swapped inputs
  if (!validateInputs()) return;

  // 3. Reverse paths in memory (Instant—no WebWorker recalculation needed)
  if (lastRenderedPaths.length > 0) {
    lastRenderedPaths = lastRenderedPaths.map((path) => [...path].reverse());
    lastSearch = {
      src: srcInput.value.trim().toLowerCase(),
      tgt: tgtInput.value.trim().toLowerCase(),
    };
    renderGraph(lastRenderedPaths);
  }
}

function solveAndDraw() {
  if (!isGraphLoaded || !validateInputs()) return;

  const src = document.getElementById("sourceWord").value.trim().toLowerCase();
  const tgt = document.getElementById("targetWord").value.trim().toLowerCase();

  if (src === lastSearch.src && tgt === lastSearch.tgt) {
    return;
  }

  showLoader("Finding Shortest Paths...");
  lastSearch = { src, tgt };

  worker.postMessage({
    action: "FIND_PATHS",
    payload: { src, tgt },
  });
}

function renderGraph(paths) {
  const canvas = document.getElementById("graphCanvas");
  const ctx = canvas.getContext("2d");

  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  ctx.clearRect(0, 0, rect.width, rect.height);

  renderedNodes = [];
  if (paths.length === 0) return;

  const layers = [];
  paths.forEach((path) => {
    path.forEach((word, step) => {
      if (!layers[step]) layers[step] = new Set();
      layers[step].add(word);
    });
  });

  let maxVerticalNodes = 1;
  layers.forEach((layerSet) => {
    if (layerSet.size > maxVerticalNodes) maxVerticalNodes = layerSet.size;
  });

  const numLayers = layers.length;
  const xSpacing = rect.width / (numLayers + 1);

  let nodeRadius = Math.min(
    20,
    xSpacing / 3.5,
    rect.height / (maxVerticalNodes + 1) / 3.5,
  );
  nodeRadius = Math.max(7, nodeRadius);

  const fontSize = Math.max(9, Math.min(13, nodeRadius * 0.75));

  const nodeCoords = new Map();

  layers.forEach((layerSet, layerIndex) => {
    const nodes = Array.from(layerSet);
    const ySpacing = rect.height / (nodes.length + 1);
    const x = xSpacing * (layerIndex + 1);

    nodes.forEach((word, nodeIndex) => {
      const y = ySpacing * (nodeIndex + 1);
      nodeCoords.set(word, { x, y });
      renderedNodes.push({ word, x, y, radius: nodeRadius });
    });
  });

  // Determine graph density
  const isDenseGraph =
    numLayers > 12 || maxVerticalNodes > 12 || paths.length > 10;
  const defaultShowLabels = !isDenseGraph;

  // Compute Directed Neighbors & Predecessors for hover interaction
  const predecessors = new Set();
  const successors = new Set();
  const activeEdges = new Set();

  if (hoveredNode) {
    const hWord = hoveredNode.word;
    paths.forEach((path) => {
      for (let i = 0; i < path.length; i++) {
        if (path[i] === hWord) {
          if (i > 0) {
            predecessors.add(path[i - 1]);
            activeEdges.add(`${path[i - 1]}->${hWord}`);
          }
          if (i < path.length - 1) {
            successors.add(path[i + 1]);
            activeEdges.add(`${hWord}->${path[i + 1]}`);
          }
        }
      }
    });
  }

  const edges = new Set();
  paths.forEach((path) => {
    for (let i = 0; i < path.length - 1; i++) {
      edges.add(`${path[i]}->${path[i + 1]}`);
    }
  });

  // Draw Edges
  edges.forEach((edge) => {
    const [u, v] = edge.split("->");
    const p1 = nodeCoords.get(u);
    const p2 = nodeCoords.get(v);

    const isActive = activeEdges.has(edge);

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);

    if (hoveredNode) {
      ctx.lineWidth = isActive ? Math.max(2.5, nodeRadius / 4) : 1;
      ctx.strokeStyle = isActive ? "#38bdf8" : "rgba(71, 85, 105, 0.25)";
    } else {
      ctx.lineWidth = Math.max(1, nodeRadius / 10);
      ctx.strokeStyle = "#475569";
    }
    ctx.stroke();
  });

  // Draw Nodes & Text
  nodeCoords.forEach((coord, word) => {
    const isStart = word === paths[0][0];
    const isEnd = word === paths[0][paths[0].length - 1];
    const isHovered = hoveredNode && hoveredNode.word === word;
    const isPredecessor = predecessors.has(word);
    const isSuccessor = successors.has(word);

    ctx.beginPath();
    ctx.arc(coord.x, coord.y, nodeRadius, 0, 2 * Math.PI);

    if (isHovered) {
      ctx.fillStyle = "#f59e0b"; // Gold
    } else if (isPredecessor) {
      ctx.fillStyle = "#a855f7"; // Purple (Inputs)
    } else if (isSuccessor) {
      ctx.fillStyle = "#06b6d4"; // Cyan (Outputs)
    } else {
      ctx.fillStyle = isStart ? "#10b981" : isEnd ? "#ef4444" : "#0284c7";
    }

    ctx.fill();

    ctx.lineWidth =
      isHovered || isPredecessor || isSuccessor
        ? 2.5
        : Math.max(1, nodeRadius / 10);
    ctx.strokeStyle = isHovered
      ? "#fbbf24"
      : isPredecessor
        ? "#c084fc"
        : isSuccessor
          ? "#67e8f9"
          : "#f8fafc";
    ctx.stroke();

    const indexInLayer = Array.from(
      renderedNodes.filter((n) => Math.abs(n.x - coord.x) < 1),
    ).findIndex((n) => n.word === word);

    const isStaggeredAbove = indexInLayer % 2 === 0;
    const textOffset = isStaggeredAbove ? -(nodeRadius + 8) : nodeRadius + 14;

    const shouldDrawText = defaultShowLabels;

    if (shouldDrawText) {
      ctx.fillStyle = isHovered
        ? "#fbbf24"
        : isPredecessor
          ? "#e9d5ff"
          : isSuccessor
            ? "#cffafe"
            : "#f8fafc";
      ctx.font =
        isHovered || isPredecessor || isSuccessor
          ? `bold ${Math.max(11, fontSize)}px monospace`
          : `bold ${fontSize}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(word, coord.x, coord.y + textOffset);
    }
  });

  // Draw Tooltip Box
  if (hoveredNode && isDenseGraph) {
    const text = hoveredNode.word;
    ctx.font = "bold 14px monospace";
    const textWidth = ctx.measureText(text).width;
    const padding = 8;
    const tooltipWidth = textWidth + padding * 2;
    const tooltipHeight = 26;

    let tx = hoveredNode.x - tooltipWidth / 2;
    let ty = hoveredNode.y - hoveredNode.radius - 38;

    tx = Math.max(10, Math.min(rect.width - tooltipWidth - 10, tx));
    ty = Math.max(10, ty);

    ctx.fillStyle = "#0f172a";
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(tx, ty, tooltipWidth, tooltipHeight, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#fbbf24";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, tx + tooltipWidth / 2, ty + tooltipHeight / 2);
  }
}

// Set up Canvas event handlers & DOM load triggers
document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("graphCanvas");

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let found = null;
    for (const node of renderedNodes) {
      const dist = Math.hypot(node.x - mx, node.y - my);
      if (dist <= node.radius + 6) {
        found = node;
        break;
      }
    }

    if (hoveredNode !== found) {
      hoveredNode = found;
      canvas.style.cursor = hoveredNode ? "pointer" : "default";
      if (lastRenderedPaths.length > 0) {
        renderGraph(lastRenderedPaths);
      }
    }
  });

  initWorker();
  loadGraphFromFile();
});

window.onresize = () => {
  if (lastRenderedPaths.length > 0) {
    renderGraph(lastRenderedPaths);
  }
};
