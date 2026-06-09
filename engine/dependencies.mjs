// Otto — dependency graph builder. Pure, deterministic, no LLM, no I/O.
// export function buildDependencies(state) ->
//   { source, nodes, edges, roots, blocked, criticalPath, cycles }
//
// Built from real issue links (child.links) when present. Edges are directed
// "A blocks B" (A -> B). We normalize the three link kinds into that direction:
//   - "blocks":         this -> other   (this blocks other)
//   - "is blocked by":  other -> this   (other blocks this)
//   - "depends on":     other -> this   (other must finish before this)
//   - "relates to":     soft edge (kept, flagged soft, ignored for path/roots)
// If NO links exist anywhere, fall back to the name-regex Foundation epic and
// set source:"inferred" so render can hedge it honestly.

import { DONE, norm, flatten } from "../core/program_state.mjs";

const HARD = new Set(["blocks", "is blocked by", "depends on"]);

function isDone(status) {
  return DONE.has(norm(status));
}

// Map a single link on `item` into a directed hard edge {from,to,type} (or null
// for soft/unknown). Direction is always "from blocks to" (from must precede to).
function edgeFor(itemKey, link) {
  const t = norm(link?.type);
  const other = link?.key;
  if (!other) return null;
  if (t === "blocks") return { from: itemKey, to: other, type: "blocks" };
  if (t === "is blocked by") return { from: other, to: itemKey, type: "blocks" };
  if (t === "depends on") return { from: other, to: itemKey, type: "depends on" };
  if (t === "relates to") return { from: itemKey, to: other, type: "relates to", soft: true };
  return null;
}

// Dedupe edges by from|to|type, keeping first.
function dedupeEdges(edges) {
  const seen = new Set();
  const out = [];
  for (const e of edges) {
    const id = `${e.from}|${e.to}|${e.type}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(e);
  }
  return out;
}

// Longest path in the hard-edge DAG (critical path) via DFS with memoization.
// Cycles are broken by a visiting-guard so this terminates even if a cycle slips
// through. Returns the longest chain of keys (>= 1 node).
function longestChain(nodeKeys, adj) {
  const memo = new Map(); // key -> { len, path:[keys] }
  const visiting = new Set();

  function dfs(key) {
    if (memo.has(key)) return memo.get(key);
    if (visiting.has(key)) return { len: 1, path: [key] }; // cycle guard
    visiting.add(key);
    let best = { len: 1, path: [key] };
    for (const next of adj.get(key) || []) {
      const sub = dfs(next);
      if (sub.len + 1 > best.len) best = { len: sub.len + 1, path: [key, ...sub.path] };
    }
    visiting.delete(key);
    memo.set(key, best);
    return best;
  }

  let best = { len: 0, path: [] };
  for (const k of nodeKeys) {
    const r = dfs(k);
    if (r.len > best.len) best = r;
  }
  return best.path;
}

// Detect cycles in the hard-edge directed graph (Tarjan-lite via DFS color).
// Returns an array of cycles, each a list of keys forming the loop.
function detectCycles(nodeKeys, adj) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(nodeKeys.map((k) => [k, WHITE]));
  const stack = [];
  const cycles = [];
  const seenCycle = new Set();

  function dfs(key) {
    color.set(key, GRAY);
    stack.push(key);
    for (const next of adj.get(key) || []) {
      if (!color.has(next)) continue; // edge to a non-node — ignore
      if (color.get(next) === GRAY) {
        // back-edge — extract the loop from the stack
        const idx = stack.indexOf(next);
        if (idx !== -1) {
          const loop = stack.slice(idx);
          const id = [...loop].sort().join("|");
          if (!seenCycle.has(id)) {
            seenCycle.add(id);
            cycles.push(loop.slice());
          }
        }
      } else if (color.get(next) === WHITE) {
        dfs(next);
      }
    }
    stack.pop();
    color.set(key, BLACK);
  }

  for (const k of nodeKeys) if (color.get(k) === WHITE) dfs(k);
  return cycles;
}

export function buildDependencies(state) {
  const items = flatten(state);
  const byKey = new Map(items.map((i) => [i.key, i]));

  // Collect all edges from real links.
  const rawEdges = [];
  let anyLink = false;
  for (const it of items) {
    const links = Array.isArray(it.links) ? it.links : [];
    for (const link of links) {
      if (link && norm(link.type)) anyLink = true;
      const e = edgeFor(it.key, link);
      if (e) rawEdges.push(e);
    }
  }

  // No links anywhere → inferred fallback (name-regex Foundation epic).
  if (!anyLink || rawEdges.length === 0) {
    const root = (state?.epics || []).find((e) =>
      /foundation|infra|platform|core/i.test(e.summary || "")
    );
    const nodes = items.map((i) => ({ key: i.key, summary: i.summary, status: i.status }));
    return {
      source: "inferred",
      nodes,
      edges: [],
      roots: root ? [root.key] : [],
      blocked: [],
      criticalPath: [],
      cycles: [],
    };
  }

  const edges = dedupeEdges(rawEdges);

  // Nodes = every item that participates in a link, plus keep summaries/status.
  // Include all items so the map is complete; render can scope to linked ones.
  const linkedKeys = new Set();
  for (const e of edges) {
    linkedKeys.add(e.from);
    linkedKeys.add(e.to);
  }
  const nodes = items
    .filter((i) => linkedKeys.has(i.key))
    .map((i) => ({ key: i.key, summary: i.summary, status: i.status }));
  // Edges may reference keys not in this state (cross-project links). Add stubs.
  for (const k of linkedKeys) {
    if (!byKey.has(k) && !nodes.find((n) => n.key === k)) {
      nodes.push({ key: k, summary: "(external)", status: "Unknown" });
    }
  }

  const nodeKeys = nodes.map((n) => n.key);

  // Hard adjacency (blocks / depends on) for roots, critical path, cycles.
  const hardAdj = new Map(nodeKeys.map((k) => [k, []]));
  const incomingHard = new Map(nodeKeys.map((k) => [k, 0]));
  for (const e of edges) {
    if (!HARD.has(e.type)) continue;
    if (!hardAdj.has(e.from)) hardAdj.set(e.from, []);
    hardAdj.get(e.from).push(e.to);
    incomingHard.set(e.to, (incomingHard.get(e.to) || 0) + 1);
  }

  // roots = nodes that block others but are not themselves blocked (no incoming
  // hard edge) — the things to schedule first.
  const roots = nodeKeys.filter(
    (k) => (hardAdj.get(k) || []).length > 0 && (incomingHard.get(k) || 0) === 0
  );

  // blocked = items with an unresolved "is blocked by" — i.e. a hard predecessor
  // that is not Done. Group blockers by blocked key.
  const blockedMap = new Map();
  for (const e of edges) {
    if (!HARD.has(e.type)) continue;
    const blocker = byKey.get(e.from);
    // If blocker is unknown (external) treat as unresolved (can't prove Done).
    const resolved = blocker ? isDone(blocker.status) : false;
    if (resolved) continue;
    if (!blockedMap.has(e.to)) blockedMap.set(e.to, []);
    if (!blockedMap.get(e.to).includes(e.from)) blockedMap.get(e.to).push(e.from);
  }
  const blocked = [...blockedMap.entries()].map(([key, blockedBy]) => ({ key, blockedBy }));

  const cycles = detectCycles(nodeKeys, hardAdj);
  const criticalPath = longestChain(nodeKeys, hardAdj);

  return { source: "links", nodes, edges, roots, blocked, criticalPath, cycles };
}
