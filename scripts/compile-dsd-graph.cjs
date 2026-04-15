#!/usr/bin/env node
/**
 * DSD Graph Compiler
 * 
 * Reads all catalog entries, writings, and changelog items,
 * auto-registers them as DSD nodes, and runs discovery passes
 * to populate edges:
 * 
 *   1. Catalog relations → authored edges
 *   2. Temporal proximity → discovered edges (same month)
 *   3. Tag overlap → shared-theme edges
 *   4. Title/slug matching → pairs-with edges
 *   5. Collection membership → collection-sibling edges
 * 
 * Run: node scripts/compile-dsd-graph.cjs
 * Output: src/data/dsd/graph.json
 */

const fs = require('fs');
const path = require('path');

// Paths — adjust CATALOG_DIR if catalog lives elsewhere
const CATALOG_DIR = 'C:\\Users\\Billy\\Documents\\Claude\\Projects\\Art Shop\\catalog\\entries';
const WRITINGS_DIR = path.resolve(__dirname, '..', 'src', 'data', 'writings');
const CHANGELOG = path.resolve(__dirname, '..', 'src', 'data', 'changelog.json');
const OUTPUT = path.resolve(__dirname, '..', 'src', 'data', 'dsd', 'graph.json');

const now = new Date().toISOString();

function loadJsonDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')); }
      catch (e) { console.warn(`  skip ${f}: ${e.message}`); return null; }
    })
    .filter(Boolean);
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function monthKey(dateStr) {
  if (!dateStr) return null;
  return dateStr.slice(0, 7); // "2022-03"
}

function tagOverlap(a, b) {
  const setA = new Set(a || []);
  return (b || []).filter(t => setA.has(t)).length;
}

// ===== LOAD ALL SOURCES =====
console.log('Loading catalog entries...');
const catalog = loadJsonDir(CATALOG_DIR);
console.log(`  ${catalog.length} catalog entries`);

console.log('Loading writings...');
const writings = loadJsonDir(WRITINGS_DIR);
console.log(`  ${writings.length} writings`);

let changelog = [];
if (fs.existsSync(CHANGELOG)) {
  try { changelog = JSON.parse(fs.readFileSync(CHANGELOG, 'utf-8')); }
  catch (e) { console.warn('  skip changelog:', e.message); }
}
console.log(`  ${changelog.length} changelog entries`);

// ===== BUILD NODES =====
const nodes = [];
const nodeMap = {};

function addNode(n) {
  if (nodeMap[n.id]) return; // deduplicate
  nodeMap[n.id] = n;
  nodes.push(n);
}

// Catalog → nodes
for (const entry of catalog) {
  const mediumMap = {
    'visual-art': 'visual', 'music': 'audio', 'digital-glitch': 'visual',
    'digital-pixel': 'visual', 'video-glitch': 'video',
  };
  const type = mediumMap[entry.medium] || (entry.medium === 'music' ? 'audio' : 'visual');

  const isCollection = entry.collection && entry.collection.type === 'series';
  addNode({
    id: entry.id,
    type: isCollection ? 'collection' : (entry.products ? 'product' : type),
    title: entry.title,
    url: entry.products ? `/product/${entry.id}` : null,
    surface: {
      thumbnail: null,
      preview: entry.description || '',
      medium: entry.medium || 'unknown',
      accent: null,
    },
    semantic: {
      tags: entry.tags || [],
      themes: [],
      temporalAnchor: entry.created || null,
      provenance: entry.provenance ? entry.provenance.method : 'unknown',
    },
  });
}

// Writings → nodes
for (const w of writings) {
  const firstLine = (w.body || '').split('\n').find(l => l.trim()) || '';
  addNode({
    id: w.slug,
    type: 'writing',
    title: `${w.title}${w.type === 'lyrics' ? ' (lyrics)' : ''}`,
    url: `/writings/${w.slug}`,
    surface: {
      thumbnail: null,
      preview: firstLine.slice(0, 80),
      medium: w.type || 'writing',
      accent: null,
    },
    semantic: {
      tags: w.tags || [],
      themes: [],
      temporalAnchor: w.date || null,
      provenance: 'hand-written',
    },
  });
}

// ===== DISCOVER EDGES =====
const edges = [];
const edgeSet = new Set(); // dedup key

function addEdge(e) {
  const key = [e.source, e.target, e.type].sort().join('::');
  if (edgeSet.has(key)) return;
  edgeSet.add(key);
  edges.push(e);
}

console.log('\nDiscovering edges...');

// Pass 1: Catalog relations → authored edges
for (const entry of catalog) {
  for (const rel of (entry.relations || [])) {
    if (nodeMap[rel.id]) {
      addEdge({
        source: entry.id,
        target: rel.id,
        type: rel.type || 'pairs-with',
        weight: 1.0,
        origin: 'authored',
        confidence: 1.0,
        discoveredAt: now,
        context: `Catalog relation: ${rel.type || 'pairs-with'}`,
        bidirectional: true,
      });
    }
  }
}
console.log(`  Pass 1 (catalog relations): ${edges.length} edges`);

// Pass 2: Title matching — songs ↔ lyrics with matching names
const prevCount2 = edges.length;
for (const entry of catalog) {
  if (entry.medium !== 'music') continue;
  const baseName = slugify(entry.title);
  for (const w of writings) {
    if (w.type !== 'lyrics') continue;
    const wBase = slugify(w.title);
    if (baseName === wBase) {
      addEdge({
        source: entry.id,
        target: w.slug,
        type: 'lyrics-for',
        weight: 0.95,
        origin: 'catalog',
        confidence: 0.9,
        discoveredAt: now,
        context: `Title match: "${entry.title}" ↔ "${w.title}"`,
        bidirectional: true,
      });
    }
  }
}
console.log(`  Pass 2 (title matching): ${edges.length - prevCount2} new edges`);

// Pass 3: Temporal proximity — same month
const prevCount3 = edges.length;
const byMonth = {};
for (const n of nodes) {
  const mk = monthKey(n.semantic?.temporalAnchor);
  if (!mk) continue;
  if (!byMonth[mk]) byMonth[mk] = [];
  byMonth[mk].push(n.id);
}
for (const [month, ids] of Object.entries(byMonth)) {
  if (ids.length < 2) continue;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      addEdge({
        source: ids[i],
        target: ids[j],
        type: 'temporal-proximity',
        weight: 0.4,
        origin: 'temporal',
        confidence: 0.7,
        discoveredAt: now,
        context: `Same month: ${month}`,
        bidirectional: true,
      });
    }
  }
}
console.log(`  Pass 3 (temporal proximity): ${edges.length - prevCount3} new edges`);

// Pass 4: Tag overlap → shared-theme edges
const prevCount4 = edges.length;
for (let i = 0; i < nodes.length; i++) {
  for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    const overlap = tagOverlap(a.semantic?.tags, b.semantic?.tags);
    if (overlap >= 2) {
      const shared = (a.semantic?.tags || []).filter(t => (b.semantic?.tags || []).includes(t));
      addEdge({
        source: a.id,
        target: b.id,
        type: 'shared-theme',
        weight: Math.min(0.3 + overlap * 0.15, 0.85),
        origin: 'semantic',
        confidence: 0.6,
        discoveredAt: now,
        context: `Shared tags: ${shared.join(', ')}`,
        bidirectional: true,
      });
    }
  }
}
console.log(`  Pass 4 (tag overlap): ${edges.length - prevCount4} new edges`);

// ===== OUTPUT =====
const graph = {
  meta: {
    version: '0.2.0',
    description: 'deaconstruckdead graph — compiled from catalog, writings, and changelog',
    lastCompiled: now,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    sources: {
      catalog: catalog.length,
      writings: writings.length,
      changelog: changelog.length,
    },
  },
  nodes,
  edges,
};

fs.writeFileSync(OUTPUT, JSON.stringify(graph, null, 2), 'utf-8');
console.log(`\nGraph compiled:`);
console.log(`  ${nodes.length} nodes`);
console.log(`  ${edges.length} edges`);
console.log(`  Written to ${OUTPUT}`);
