/**
 * Build writings index from individual writing JSON files.
 * Generates src/data/writings.json for the writings index page.
 * 
 * Run: node scripts/build-writings-index.cjs
 */
const fs = require('fs');
const path = require('path');

const DIR = path.resolve(__dirname, '..', 'src', 'data', 'writings');
const OUT = path.resolve(__dirname, '..', 'src', 'data', 'writings.json');

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json'));
const index = files.map(f => {
  const entry = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf-8'));
  return {
    slug: entry.slug,
    title: entry.title,
    type: entry.type,
    artist: entry.artist,
    year: entry.year || 'unknown',
    description: entry.description || '',
  };
}).sort((a, b) => a.title.localeCompare(b.title));

fs.writeFileSync(OUT, JSON.stringify(index, null, 2), 'utf-8');
console.log(`Wrote ${index.length} entries to writings.json`);
