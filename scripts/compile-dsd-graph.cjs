#!/usr/bin/env node
/**
 * DSD Graph Compiler
 * 
 * Reads all catalog entries, writings, and changelog items,
 * auto-registers them as DSD nodes, and runs discovery passes
 * to populate edges:
 * 
 *   1. Catalog relations → authored edges
 *   2. Title/slug matching → lyrics-for edges
 *   3. Temporal proximity → same-month edges
 *   4. Tag overlap → shared-theme edges
 *   5. Variant linking → forked-from edges (slug ↔ slug-2)
 *   6. Vocabulary overlap → semantic-echo edges (shared distinctive words)
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

// Pass 5: Variant linking — connect base slugs with their -2 (or -N) variants
// Many writings exist as pairs (e.g. "choice" and "choice-2") that are alternate
// versions or drafts of the same piece. These should be strongly connected.
const prevCount5 = edges.length;
for (const w of writings) {
  const match = w.slug.match(/^(.+)-(\d+)$/);
  if (match) {
    const baseSlug = match[1];
    if (nodeMap[baseSlug] && nodeMap[w.slug]) {
      addEdge({
        source: baseSlug,
        target: w.slug,
        type: 'forked-from',
        weight: 0.9,
        origin: 'structural',
        confidence: 0.95,
        discoveredAt: now,
        context: `Variant: "${baseSlug}" ↔ "${w.slug}"`,
        bidirectional: true,
      });
    }
  }
}
console.log(`  Pass 5 (variant linking): ${edges.length - prevCount5} new edges`);

// Pass 6: Vocabulary overlap (semantic echo)
// For writings with body text, extract distinctive words (skip stop words),
// then find pairs with significant shared vocabulary. This discovers thematic
// resonance between pieces that share no tags or dates.
const prevCount6 = edges.length;
const STOP_WORDS = new Set([
  'i', 'me', 'my', 'we', 'you', 'your', 'it', 'its', 'the', 'a', 'an',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'shall',
  'can', 'may', 'might', 'must', 'to', 'of', 'in', 'for', 'on', 'with',
  'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after',
  'and', 'but', 'or', 'nor', 'not', 'no', 'so', 'if', 'than', 'that',
  'this', 'these', 'those', 'what', 'which', 'who', 'whom', 'when', 'where',
  'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'some', 'such', 'only', 'own', 'same', 'just', 'like', 'cuz', 'got',
  'get', 'up', 'out', 'about', 'then', 'them', 'they', 'their', 'there',
  'here', 'him', 'her', 'his', 'she', 'he', 'us', 'our', 'too', 'very',
  "don't", 'dont', 'im', "i'm", "it's", "that's", "what's", 'let',
  'go', 'going', 'come', 'know', 'see', 'say', 'said', 'make', 'made',
  'take', 'back', 'down', 'over', 'still', 'well', 'also', 'way', 'even',
  'because', 'thing', 'things', 'much', 'many', 'one', 'two', 'now',
  'never', 'always', 'gonna', 'wanna', "ain't", 'aint', 'yeah', 'oh',
  'keep', 'need', 'want', 'look', 'feel', 'right', 'left', 'been',
  'really', 'already', 'something', 'nothing', 'everything', 'anything',
  'put', 'end', 'start', 'try', 'turn', 'give', 'tell', 'ask',
  'while', 'until', 'again', 'once', 'though', 'why', 'yet',
]);

function extractVocab(text) {
  if (!text) return new Set();
  const words = text.toLowerCase().replace(/[^a-z'\s-]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  return new Set(words.filter(w => !STOP_WORDS.has(w)));
}

function vocabOverlap(setA, setB) {
  let count = 0;
  const shared = [];
  for (const w of setA) {
    if (setB.has(w)) { count++; shared.push(w); }
  }
  return { count, shared };
}

// Pre-compute vocabularies for all writings with body text
const writingVocabs = [];
for (const w of writings) {
  if (!w.body || w.body.length < 50) continue;
  const vocab = extractVocab(w.body);
  if (vocab.size > 5) {
    writingVocabs.push({ slug: w.slug, vocab, size: vocab.size });
  }
}

// Compare pairs — require significant overlap relative to vocabulary size
for (let i = 0; i < writingVocabs.length; i++) {
  for (let j = i + 1; j < writingVocabs.length; j++) {
    const a = writingVocabs[i], b = writingVocabs[j];
    // Skip variant pairs (already connected by Pass 5)
    if (a.slug.replace(/-\d+$/, '') === b.slug.replace(/-\d+$/, '')) continue;

    const { count, shared } = vocabOverlap(a.vocab, b.vocab);
    const minSize = Math.min(a.size, b.size);
    const ratio = count / minSize;

    // Require at least 12 shared distinctive words AND >25% overlap ratio
    // Conservative thresholds — only surface strong thematic resonances
    if (count >= 12 && ratio >= 0.25) {
      const weight = Math.min(0.2 + ratio * 0.4, 0.55);
      addEdge({
        source: a.slug,
        target: b.slug,
        type: 'semantic-echo',
        weight,
        origin: 'ai-shadow',
        confidence: Math.min(0.3 + ratio * 0.3, 0.5),
        discoveredAt: now,
        context: `Vocab overlap: ${count} words (${(ratio * 100).toFixed(0)}%) — ${shared.slice(0, 6).join(', ')}...`,
        bidirectional: true,
      });
    }
  }
}
console.log(`  Pass 6 (vocabulary overlap): ${edges.length - prevCount6} new edges`);

// ===== OUTPUT =====
const graph = {
  meta: {
    version: '0.3.0',
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

// ===== HEALTH REPORT =====
const connected = new Set();
for (const e of edges) { connected.add(e.source); connected.add(e.target); }
const orphanCount = nodes.filter(n => !connected.has(n.id)).length;
const edgeTypes = {};
for (const e of edges) { edgeTypes[e.type] = (edgeTypes[e.type] || 0) + 1; }
console.log(`\nHealth report:`);
console.log(`  Orphan nodes: ${orphanCount} / ${nodes.length}`);
console.log(`  Edge type distribution:`);
for (const [type, count] of Object.entries(edgeTypes).sort((a,b) => b[1] - a[1])) {
  console.log(`    ${type}: ${count}`);
}
