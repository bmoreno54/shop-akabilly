/**
 * akabilly desktop editor server
 * 
 * Local-only API that bridges the website's author mode
 * to the ocean vault. Handles:
 * - PUT /api/writings/:slug — update writing text
 *   Archives previous version, writes new, updates site data
 * 
 * Versioning model: sedimentary, not diff-based.
 * Each save creates a dated layer in the vault's archive.
 * Old versions accumulate — they never get deleted or squashed.
 * 
 * Run: node desktop/editor-server.js
 * Listens on localhost:7700 (never exposed to network)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 7700;
const VAULT_DIR = 'D:\\vault';
const SITE_DATA_DIR = 'D:\\akabilly\\shop-akabilly\\src\\data\\writings';

// Archive directory in vault — sedimentary versioning
const ARCHIVE_DIR = path.join(VAULT_DIR, 'Archive', 'writings');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function handleWritingUpdate(slug, res) {
  const dataFile = path.join(SITE_DATA_DIR, `${slug}.json`);
  
  if (!fs.existsSync(dataFile)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Writing not found' }));
    return null;
  }
  
  return dataFile;
}

const server = http.createServer(async (req, res) => {
  cors(res);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Route: PUT /api/writings/:slug
  const match = req.url?.match(/^\/api\/writings\/([a-z0-9-]+)$/);
  if (match && req.method === 'PUT') {
    const slug = match[1];
    const dataFile = path.join(SITE_DATA_DIR, `${slug}.json`);

    if (!fs.existsSync(dataFile)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: `Writing "${slug}" not found` }));
      return;
    }

    try {
      const rawBody = await readBody(req);
      const { body: newText } = JSON.parse(rawBody);

      if (typeof newText !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing body text' }));
        return;
      }

      // 1. Read current entry
      const entry = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
      const previousBody = entry.body;

      // 2. Archive previous version (sedimentary — never deleted)
      ensureDir(path.join(ARCHIVE_DIR, slug));
      const archiveName = `${slug}_${timestamp()}.txt`;
      const archivePath = path.join(ARCHIVE_DIR, slug, archiveName);
      fs.writeFileSync(archivePath, previousBody, 'utf-8');
      console.log(`[archive] ${archivePath}`);

      // 3. Update entry with new text
      entry.body = newText;
      entry.lastEdited = new Date().toISOString();
      if (!entry.versionHistory) entry.versionHistory = [];
      entry.versionHistory.push({
        archived: archivePath,
        timestamp: new Date().toISOString(),
        charDelta: newText.length - previousBody.length,
      });
      fs.writeFileSync(dataFile, JSON.stringify(entry, null, 2), 'utf-8');
      console.log(`[update] ${dataFile}`);

      // 4. Also update vault source if it exists
      const vaultSource = path.join(VAULT_DIR, `${entry.title || slug}.md`);
      if (fs.existsSync(vaultSource)) {
        // Archive vault copy too
        const vaultArchive = path.join(ARCHIVE_DIR, slug, `vault_${timestamp()}.md`);
        fs.copyFileSync(vaultSource, vaultArchive);
        fs.writeFileSync(vaultSource, newText, 'utf-8');
        console.log(`[vault-sync] ${vaultSource}`);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        archived: archivePath,
        slug,
      }));

    } catch (err) {
      console.error('[error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  // Route: POST /api/writings/:slug/remix — add a remix layer
  const remixMatch = req.url?.match(/^\/api\/writings\/([a-z0-9-]+)\/remix$/);
  if (remixMatch && req.method === 'POST') {
    const slug = remixMatch[1];
    const dataFile = path.join(SITE_DATA_DIR, `${slug}.json`);

    if (!fs.existsSync(dataFile)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: `Writing "${slug}" not found` }));
      return;
    }

    try {
      const rawBody = await readBody(req);
      const remix = JSON.parse(rawBody);

      if (!remix.slug || !remix.author || !remix.body) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Remix needs slug, author, body' }));
        return;
      }

      // Add defaults
      remix.created = remix.created || new Date().toISOString().slice(0, 10);
      remix.type = remix.type || 'remix';
      remix.promoted = remix.promoted || false;
      remix.stats = { views: 0, shares: 0 };

      // Update writing entry
      const entry = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
      if (!entry.remixes) entry.remixes = [];
      // Don't duplicate
      entry.remixes = entry.remixes.filter(r => r.slug !== remix.slug);
      entry.remixes.push(remix);
      fs.writeFileSync(dataFile, JSON.stringify(entry, null, 2), 'utf-8');

      // Register remix as DSD node + edge
      const graphFile = path.join(SITE_DATA_DIR, '..', 'dsd', 'graph.json');
      if (fs.existsSync(graphFile)) {
        const graph = JSON.parse(fs.readFileSync(graphFile, 'utf-8'));
        const remixNodeId = `${slug}-${remix.slug}`;

        // Add node if not exists
        if (!graph.nodes.find(n => n.id === remixNodeId)) {
          graph.nodes.push({
            id: remixNodeId,
            type: 'writing',
            title: `${entry.title} (${remix.title || remix.author + "'s " + remix.type})`,
            url: `/writings/${slug}#${remix.slug}`,
            surface: {
              thumbnail: null,
              preview: remix.body.split('\n').find(l => l.trim()) || '',
              medium: remix.type,
              accent: null,
            },
            semantic: {
              tags: [...(entry.tags || []), 'remix'],
              themes: [],
              temporalAnchor: remix.created,
              provenance: `${remix.type}-by-${remix.author}`,
            },
          });
        }

        // Add remix-of edge
        if (!graph.edges.find(e => e.source === remixNodeId && e.target === slug)) {
          graph.edges.push({
            source: remixNodeId,
            target: slug,
            type: 'remix-of',
            weight: 0.75,
            origin: 'authored',
            confidence: 1.0,
            discoveredAt: new Date().toISOString(),
            context: `${remix.type} by ${remix.author}`,
            bidirectional: true,
          });
        }

        graph.meta.nodeCount = graph.nodes.length;
        graph.meta.edgeCount = graph.edges.length;
        graph.meta.lastUpdated = new Date().toISOString();
        fs.writeFileSync(graphFile, JSON.stringify(graph, null, 2), 'utf-8');
        console.log(`[dsd] registered remix node ${remixNodeId}`);
      }

      console.log(`[remix] added ${remix.slug} to ${slug}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, slug: remix.slug }));
    } catch (err) {
      console.error('[error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  // Fallback
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`akabilly desktop editor listening on http://127.0.0.1:${PORT}`);
  console.log(`vault: ${VAULT_DIR}`);
  console.log(`site data: ${SITE_DATA_DIR}`);
  console.log(`archive: ${ARCHIVE_DIR}`);
});
