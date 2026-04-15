#!/usr/bin/env node
/**
 * DSD Graph Compiler v0.4.0
 * 
 * Reads all catalog entries, writings, and changelog items,
 * auto-registers them as DSD nodes, and runs discovery passes
 * to populate edges. Includes triage classification and
 * synesthetic multi-lens analysis.
 * 
 * Discovery passes:
 *   1. Catalog relations → authored edges
 *   2. Title/slug matching → lyrics-for edges
 *   3. Temporal proximity → same-month edges
 *   4. Tag overlap → shared-theme edges
 *   5. Variant linking → forked-from edges (slug ↔ slug-2)
 *   6. Synesthetic analysis → semantic-echo edges (multi-lens resonance)
 * 
 * Triage classifications:
 *   full       — genuine creative content, full weight
 *   fragment   — very short, kept but flagged
 *   metadata-heavy — real content under preamble, analyzed after stripping
 *   daily-note — journal/twitter/calendar capture, demoted
 *   scaffold   — empty template or purely structural, excluded from discovery
 *   metadata-only — no creative content, excluded from discovery
 *   variant    — filing-channel duplicate (-2), secondary to canonical
 * 
 * Run: node scripts/compile-dsd-graph.cjs
 * Output: src/data/dsd/graph.json
 */

const fs = require('fs');
const path = require('path');

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
  return dateStr.slice(0, 7);
}

function tagOverlap(a, b) {
  const setA = new Set(a || []);
  return (b || []).filter(t => setA.has(t)).length;
}
