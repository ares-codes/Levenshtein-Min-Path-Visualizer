let wordGraph = new Map();
let cachedPaths = [];

self.onmessage = function (e) {
  const { action, payload } = e.data;

  if (action === "PARSE_GRAPH") {
    parseConnectionsText(payload);
    const wordList = Array.from(wordGraph.keys());
    self.postMessage({ action: "GRAPH_PARSED", payload: { wordList } });
  } else if (action === "FIND_PATHS") {
    const { src, tgt } = payload;
    const result = getMinLevenshteinPaths(src, tgt);
    cachedPaths = result.paths;
    self.postMessage({ action: "PATHS_FOUND", payload: result });
  }
};

function parseConnectionsText(text) {
  wordGraph.clear();
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) continue;

    const [wordA, wordB] = line
      .split(",")
      .map((w) => (w ? w.trim().toLowerCase() : null));
    if (!wordA || !wordB) continue;

    if (!wordGraph.has(wordA)) wordGraph.set(wordA, new Set());
    if (!wordGraph.has(wordB)) wordGraph.set(wordB, new Set());

    wordGraph.get(wordA).add(wordB);
    wordGraph.get(wordB).add(wordA);
  }
}

function getMinLevenshteinPaths(src, tgt) {
  if (src === tgt) {
    return { distance: 0, paths: [[src]] };
  }

  const srcNeighbors = wordGraph.get(src);
  if (srcNeighbors && srcNeighbors.has(tgt)) {
    return { distance: 1, paths: [[src, tgt]] };
  }

  if (cachedPaths.length > 0) {
    let slicedPaths = [];
    for (const path of cachedPaths) {
      const srcIdx = path.indexOf(src);
      const tgtIdx = path.indexOf(tgt);

      if (srcIdx !== -1 && tgtIdx !== -1 && srcIdx < tgtIdx) {
        const subPath = path.slice(srcIdx, tgtIdx + 1);
        slicedPaths.push(subPath);
      }
    }

    if (slicedPaths.length > 0) {
      const uniqueSubpaths = Array.from(
        new Set(slicedPaths.map((p) => p.join(","))),
      ).map((s) => s.split(","));

      const distance = uniqueSubpaths[0].length - 1;
      return { distance, paths: uniqueSubpaths };
    }
  }

  let queue = [[src]];
  let visitedThisLevel = new Set();
  let globalVisited = new Set([src]);
  let foundShortestPath = false;
  let allMinPaths = [];

  while (queue.length > 0 && !foundShortestPath) {
    const levelSize = queue.length;
    visitedThisLevel.clear();

    for (let i = 0; i < levelSize; i++) {
      const currentPath = queue.shift();
      const currentWord = currentPath[currentPath.length - 1];

      const neighbors = wordGraph.get(currentWord) || new Set();

      for (const neighbor of neighbors) {
        if (!globalVisited.has(neighbor)) {
          const newPath = [...currentPath, neighbor];

          if (neighbor === tgt) {
            foundShortestPath = true;
            allMinPaths.push(newPath);
          } else {
            visitedThisLevel.add(neighbor);
            queue.push(newPath);
          }
        }
      }
    }

    for (const word of visitedThisLevel) {
      globalVisited.add(word);
    }
  }

  const distance =
    allMinPaths.length > 0 ? allMinPaths[0].length - 1 : "No Path";
  return { distance, paths: allMinPaths };
}
