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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const commaIdx = line.indexOf(",");
    if (commaIdx === -1) continue;

    const wordA = line.slice(0, commaIdx).trim().toLowerCase();
    const wordB = line
      .slice(commaIdx + 1)
      .trim()
      .toLowerCase();

    if (!wordA || !wordB) continue;

    let setA = wordGraph.get(wordA);
    if (!setA) {
      setA = new Set();
      wordGraph.set(wordA, setA);
    }
    setA.add(wordB);

    let setB = wordGraph.get(wordB);
    if (!setB) {
      setB = new Set();
      wordGraph.set(wordB, setB);
    }
    setB.add(wordA);
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

  // Check subpath cache validity
  if (cachedPaths.length > 0) {
    let slicedPaths = [];
    let minSubLen = Infinity;

    for (const path of cachedPaths) {
      const srcIdx = path.indexOf(src);
      const tgtIdx = path.indexOf(tgt);

      if (srcIdx !== -1 && tgtIdx !== -1 && srcIdx < tgtIdx) {
        const subPath = path.slice(srcIdx, tgtIdx + 1);
        if (subPath.length < minSubLen) {
          minSubLen = subPath.length;
          slicedPaths = [subPath];
        } else if (subPath.length === minSubLen) {
          slicedPaths.push(subPath);
        }
      }
    }

    if (slicedPaths.length > 0) {
      const pathSet = new Set();
      const uniqueSubpaths = [];
      for (const p of slicedPaths) {
        const key = p.join(",");
        if (!pathSet.has(key)) {
          pathSet.add(key);
          uniqueSubpaths.push(p);
        }
      }
      return { distance: uniqueSubpaths[0].length - 1, paths: uniqueSubpaths };
    }
  }

  // Fast Bi-Directional BFS for Shortest Paths
  return findShortestPathsBiDirectional(src, tgt);
}

function findShortestPathsBiDirectional(src, tgt) {
  let forwardVisited = new Map([[src, [[]]]]); // word -> array of predecessor paths
  let backwardVisited = new Map([[tgt, [[]]]]); // word -> array of successor paths

  let forwardQueue = new Set([src]);
  let backwardQueue = new Set([tgt]);

  let meetingNodes = new Set();
  let found = false;

  while (forwardQueue.size > 0 && backwardQueue.size > 0 && !found) {
    // Always expand the smaller frontier to minimize search space
    if (forwardQueue.size <= backwardQueue.size) {
      const nextQueue = new Set();
      const levelVisited = new Map();

      for (const word of forwardQueue) {
        const neighbors = wordGraph.get(word) || new Set();
        const pathsToWord = forwardVisited.get(word);

        for (const neighbor of neighbors) {
          if (backwardVisited.has(neighbor)) {
            found = true;
            meetingNodes.add(neighbor);
          }

          if (!forwardVisited.has(neighbor)) {
            if (!levelVisited.has(neighbor)) {
              levelVisited.set(neighbor, []);
              nextQueue.add(neighbor);
            }
            for (const p of pathsToWord) {
              levelVisited.get(neighbor).push([...p, word]);
            }
          }
        }
      }

      for (const [w, paths] of levelVisited.entries()) {
        forwardVisited.set(w, paths);
      }
      forwardQueue = nextQueue;
    } else {
      const nextQueue = new Set();
      const levelVisited = new Map();

      for (const word of backwardQueue) {
        const neighbors = wordGraph.get(word) || new Set();
        const pathsFromWord = backwardVisited.get(word);

        for (const neighbor of neighbors) {
          if (forwardVisited.has(neighbor)) {
            found = true;
            meetingNodes.add(neighbor);
          }

          if (!backwardVisited.has(neighbor)) {
            if (!levelVisited.has(neighbor)) {
              levelVisited.set(neighbor, []);
              nextQueue.add(neighbor);
            }
            for (const p of pathsFromWord) {
              levelVisited.get(neighbor).push([word, ...p]);
            }
          }
        }
      }

      for (const [w, paths] of levelVisited.entries()) {
        backwardVisited.set(w, paths);
      }
      backwardQueue = nextQueue;
    }
  }

  if (!found || meetingNodes.size === 0) {
    return { distance: "No Path", paths: [] };
  }

  // Reconstruct full paths from meeting nodes
  const fullPaths = [];
  for (const meet of meetingNodes) {
    const fPaths = forwardVisited.get(meet) || [[]];
    const bPaths = backwardVisited.get(meet) || [[]];

    for (const f of fPaths) {
      for (const b of bPaths) {
        fullPaths.push([...f, meet, ...b]);
      }
    }
  }

  const distance = fullPaths[0].length - 1;
  return { distance, paths: fullPaths };
}
