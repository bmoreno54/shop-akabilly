/**
 * Session Trail Engine
 * 
 * Tracks the current user's journey through the site within a single session.
 * Computes tag momentum, visited-node affinity, and temporal recency to
 * influence what the DSD surfaces at each node.
 *
 * No cookies, no server calls — pure sessionStorage.
 * The trail is ephemeral by design: each session is a fresh walk.
 *
 * API:
 *   SessionTrail.visit(nodeId, tags, type)  — record a page visit
 *   SessionTrail.getTrail()                 — full ordered trail
 *   SessionTrail.getMomentum()              — tag frequency map, decayed by recency
 *   SessionTrail.score(nodeId, tags)        — affinity score for a candidate node
 *   SessionTrail.getMode()                  — current nav mode (quiet/explore/guided)
 *   SessionTrail.setMode(mode)              — switch nav mode
 *   SessionTrail.getGuidedPath()            — current guided path if active
 *   SessionTrail.setGuidedPath(path)        — set a guided path
 *   SessionTrail.getGuidedIndex()           — current position in guided path
 *   SessionTrail.advanceGuided()            — move to next in guided path
 */

const TRAIL_KEY = 'akb-session-trail';
const MODE_KEY = 'akb-nav-mode';
const GUIDED_KEY = 'akb-guided-path';
const GUIDED_IDX_KEY = 'akb-guided-idx';
// Decay factor: each step back in history multiplies weight by this
const RECENCY_DECAY = 0.85;

function load(key, fallback) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function save(key, val) {
  try { sessionStorage.setItem(key, JSON.stringify(val)); } catch {}
}

/**
 * Record a page visit.
 * @param {string} nodeId — slug or DSD node ID
 * @param {string[]} tags — semantic tags for this node
 * @param {string} type — node type (writing, audio, product, etc.)
 */
export function visit(nodeId, tags = [], type = 'unknown') {
  const trail = load(TRAIL_KEY, []);
  // Don't double-record immediate revisits
  if (trail.length > 0 && trail[trail.length - 1].id === nodeId) return;
  trail.push({
    id: nodeId,
    tags,
    type,
    ts: Date.now(),
  });
  // Cap trail at 200 entries to avoid bloat
  if (trail.length > 200) trail.splice(0, trail.length - 200);
  save(TRAIL_KEY, trail);
}
/** Get the full ordered trail. */
export function getTrail() {
  return load(TRAIL_KEY, []);
}

/** Get set of visited node IDs. */
export function getVisitedIds() {
  return new Set(getTrail().map(v => v.id));
}

/**
 * Compute tag momentum — how much each tag matters right now.
 * Recent visits weigh more. Returns Map<tag, weight>.
 */
export function getMomentum() {
  const trail = getTrail();
  const momentum = new Map();
  const len = trail.length;
  for (let i = 0; i < len; i++) {
    // Most recent = index len-1, weight = 1.0
    // Each step back decays
    const recency = Math.pow(RECENCY_DECAY, len - 1 - i);
    for (const tag of (trail[i].tags || [])) {
      momentum.set(tag, (momentum.get(tag) || 0) + recency);
    }
  }
  return momentum;
}
/**
 * Score a candidate node for trail-aware surfacing.
 * Higher score = more relevant to current journey.
 * 
 * Factors:
 *   - Tag overlap with momentum (strongest signal)
 *   - Not-yet-visited bonus (novelty)
 *   - Type variety bonus (avoid monotony)
 *   - Recency of related visits
 *
 * @param {string} nodeId — candidate node ID
 * @param {string[]} tags — candidate's tags
 * @param {string} type — candidate's type
 * @param {number} graphWeight — base weight from DSD edge (0-1)
 * @returns {number} combined score
 */
export function score(nodeId, tags = [], type = 'unknown', graphWeight = 0.5) {
  const trail = getTrail();
  const visited = getVisitedIds();
  const momentum = getMomentum();

  let tagScore = 0;
  for (const tag of tags) {
    tagScore += momentum.get(tag) || 0;
  }
  // Normalize by tag count to avoid penalizing sparse nodes
  if (tags.length > 0) tagScore /= tags.length;

  // Novelty: unvisited nodes get a boost
  const novelty = visited.has(nodeId) ? 0.0 : 0.3;

  // Type variety: if last 3 visits are same type, boost different types
  const recentTypes = trail.slice(-3).map(v => v.type);
  const typeVariety = recentTypes.every(t => t === type) ? 0.0 : 0.15;

  // Combine: graph weight is the foundation, session factors modulate
  return graphWeight * 0.4 + tagScore * 0.35 + novelty + typeVariety;
}
// === Navigation Modes ===

/** Get current navigation mode. Default: 'explore'. */
export function getMode() {
  return load(MODE_KEY, 'explore');
}

/** Set navigation mode: 'quiet', 'explore', or 'guided'. */
export function setMode(mode) {
  if (!['quiet', 'explore', 'guided'].includes(mode)) return;
  save(MODE_KEY, mode);
  // Dispatch custom event so components can react
  window.dispatchEvent(new CustomEvent('akb-mode-change', { detail: { mode } }));
}

// === Guided Paths ===

/**
 * A guided path is an ordered list of node IDs with optional metadata.
 * Format: [{ id, title?, reason? }, ...]
 */
export function getGuidedPath() {
  return load(GUIDED_KEY, null);
}

export function setGuidedPath(path) {
  save(GUIDED_KEY, path);
  save(GUIDED_IDX_KEY, 0);
  window.dispatchEvent(new CustomEvent('akb-guided-change', { detail: { path } }));
}

export function clearGuidedPath() {
  sessionStorage.removeItem(GUIDED_KEY);
  sessionStorage.removeItem(GUIDED_IDX_KEY);
  window.dispatchEvent(new CustomEvent('akb-guided-change', { detail: { path: null } }));
}

export function getGuidedIndex() {
  return load(GUIDED_IDX_KEY, 0);
}

export function advanceGuided() {
  const path = getGuidedPath();
  if (!path) return null;
  let idx = getGuidedIndex() + 1;
  if (idx >= path.length) idx = path.length - 1;
  save(GUIDED_IDX_KEY, idx);
  return path[idx] || null;
}

export function retreatGuided() {
  let idx = getGuidedIndex() - 1;
  if (idx < 0) idx = 0;
  save(GUIDED_IDX_KEY, idx);
  const path = getGuidedPath();
  return path ? path[idx] : null;
}
// === Random Walk Generator ===

/**
 * Generate a random guided path through the graph.
 * Prefers high-weight edges and avoids already-visited nodes.
 * @param {object} graph — the DSD graph ({ nodes, edges })
 * @param {string} startId — starting node ID
 * @param {number} length — desired path length
 * @returns {Array<{id, title, reason}>}
 */
export function generateRandomWalk(graph, startId, length = 8) {
  const visited = getVisitedIds();
  const nodeMap = {};
  for (const n of graph.nodes) nodeMap[n.id] = n;

  const path = [];
  let current = startId;

  for (let step = 0; step < length; step++) {
    // Find edges from current node
    const candidates = graph.edges
      .filter(e => e.source === current || e.target === current)
      .map(e => ({
        id: e.source === current ? e.target : e.source,
        weight: e.weight || 0.5,
        type: e.type,
        context: e.context,
      }))
      .filter(c => nodeMap[c.id] && nodeMap[c.id].url)
      .filter(c => !path.some(p => p.id === c.id));

    if (candidates.length === 0) break;

    // Weighted random selection, boosting unvisited
    for (const c of candidates) {
      if (!visited.has(c.id)) c.weight *= 1.5;
    }
    const totalWeight = candidates.reduce((s, c) => s + c.weight, 0);
    let roll = Math.random() * totalWeight;
    let chosen = candidates[0];
    for (const c of candidates) {
      roll -= c.weight;
      if (roll <= 0) { chosen = c; break; }
    }

    const node = nodeMap[chosen.id];
    path.push({
      id: chosen.id,
      title: node.title,
      url: node.url,
      reason: chosen.context || chosen.type,
    });
    current = chosen.id;
  }

  return path;
}

// Export as namespace for non-module usage
if (typeof window !== 'undefined') {
  window.SessionTrail = {
    visit, getTrail, getVisitedIds, getMomentum, score,
    getMode, setMode,
    getGuidedPath, setGuidedPath, clearGuidedPath,
    getGuidedIndex, advanceGuided, retreatGuided,
    generateRandomWalk,
  };
}