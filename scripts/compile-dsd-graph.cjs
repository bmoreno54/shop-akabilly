#!/usr/bin/env node
/**
 * DSD Graph Compiler v0.4.0
 *
 * Discovery passes:
 *   1. Catalog relations → authored edges
 *   2. Title/slug matching → lyrics-for edges
 *   3. Temporal proximity → same-month edges
 *   4. Tag overlap → shared-theme edges
 *   5. Variant linking → forked-from edges
 *   6. Synesthetic analysis → semantic-echo edges (multi-lens resonance)
 *
 * Triage: scaffold | metadata-only | daily-note | metadata-heavy | fragment | variant | full
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
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')); }
    catch (e) { console.warn(`  skip ${f}: ${e.message}`); return null; }
  }).filter(Boolean);
}
function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function monthKey(d) { return d ? d.slice(0, 7) : null; }
function tagOverlap(a, b) { const s = new Set(a || []); return (b || []).filter(t => s.has(t)).length; }

// ===== TRIAGE CLASSIFIER =====
function triageWriting(w) {
  const body = w.body || '', slug = w.slug || '';
  const templateBlocks = (body.match(/\)\)\}\}/g) || []).length;
  const similarPages = (body.match(/you used similar pages extension/gi) || []).length;
  const roamRefs = (body.match(/#\[?roam\/templates\]?/gi) || []).length;
  const twitterRefs = (body.match(/#twitter feed|twitter\.com|\/i\/web\/status/gi) || []).length;
  const calendarRefs = (body.match(/google\.com\/calendar|agenda|\d{2}:\d{2}\s*(am|pm)/gi) || []).length;
  const weekHeaders = (body.match(/#\d{2}\/\d{2}\s+\d{4}/g) || []).length;
  const dailyNoteHdr = (body.match(/^-?\s*daily notes/mi) || []).length;
  let cleaned = body
    .replace(/on \w+ \d+\w*,\s*\d{4} you used similar pages extension[^\n]*/gi, '')
    .replace(/\)\)\}\}/g, '').replace(/https?:\/\/[^\s)]+/g, '')
    .replace(/#\[?roam\/templates\]?/gi, '')
    .replace(/#\d{2}\/\d{2}\s+\d{4}\s*-\s*\d{2}\/\d{2}\s+\d{4}/g, '')
    .replace(/#twitter feed/gi, '').replace(/^-?\s*daily notes\s*$/gmi, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^[\s\-*]+$/gm, '')
    .split('\n').filter(l => l.trim().length > 1).join('\n').trim();
  const cl = cleaned.length;
  const sectionOnly = /^(lyrics|collaborators|videos|art|recordings|notes|other media|tags|song title|template)$/i;
  const contentLines = cleaned.split('\n').filter(l => !sectionOnly.test(l.trim()));
  if (roamRefs > 0 && cl < 50) return { cls: 'scaffold', clean: '', why: 'Roam template scaffold' };
  if (contentLines.length === 0 && body.split('\n').filter(l=>l.trim()).length > 0)
    return { cls: 'scaffold', clean: '', why: 'Only section headers' };
  if (similarPages >= 3 && cl < 80) return { cls: 'metadata-only', clean: '', why: `${similarPages} similar-pages, no residual content` };
  if (templateBlocks >= 8 && cl < 50) return { cls: 'metadata-only', clean: '', why: `${templateBlocks} empty template blocks` };
  if (twitterRefs >= 3 || (dailyNoteHdr > 0 && twitterRefs >= 1) || (weekHeaders > 0 && calendarRefs >= 1))
    return { cls: 'daily-note', clean: cleaned, why: `Journal: ${twitterRefs}tw ${calendarRefs}cal ${weekHeaders}wk` };
  if (slug.match(/-2$/)) return { cls: 'variant', clean: cleaned, why: `Filing dup of ${slug.replace(/-2$/,'')}` };
  if ((similarPages >= 2 || templateBlocks >= 4) && cl >= 80)
    return { cls: 'metadata-heavy', clean: cleaned, why: `Content under ${similarPages} meta + ${templateBlocks} blocks` };
  if (cl < 100 && cl > 0) return { cls: 'fragment', clean: cleaned, why: `${cl} chars` };
  return { cls: 'full', clean: cleaned, why: 'Full creative content' };
}

// ===== SYNESTHETIC LENSES =====
const LENSES = {
  chromatic: {
    dark: ['dark','darkness','shadow','shadows','black','night','blind','dim','void','abyss','midnight','shade','gloom','buried','murky'],
    light: ['light','bright','glow','shine','sun','star','stars','fire','flame','burn','burning','golden','radiant','flash','spark','dawn','neon'],
    color: ['red','blue','green','gold','silver','white','grey','purple','violet','crimson','amber','blood','sky','ocean','earth','rust'],
  },
  kinetic: {
    motion: ['run','running','climb','climbing','fall','falling','fly','flying','jump','chase','rush','drift','float','ride','spin','dance','walk','crawl','kick','push','pull','throw','swing'],
    stillness: ['still','freeze','frozen','stuck','wait','waiting','pause','rest','sleep','stand','settle','anchor','root','rooted','grounded'],
    tension: ['break','breaking','crack','shatter','tear','rip','snap','explode','collapse','crash','hit','strike','fight','struggle','grip','hold','clench','war','battle'],
    release: ['release','free','freedom','loose','open','unfold','breathe','exhale','flow','pour','melt','dissolve','surrender','forgive'],
  },
  sonic: {
    loud: ['loud','scream','screaming','shout','yell','roar','thunder','bang','boom','blast','noise','echo','ring','ringing','alarm'],
    quiet: ['quiet','silence','silent','whisper','hush','mute','muted','soft','gentle','murmur','hum','humming','lull','calm'],
    music: ['song','sing','singing','melody','rhythm','beat','bass','drum','guitar','piano','mic','verse','chorus','rap','rhyme','flow','track','record','mix','tune','note','harmony'],
    voice: ['voice','voices','speak','tongue','word','words','language','name','call','calling','story','stories','lyric','lyrics','poetry'],
  },
  spatial: {
    interior: ['inside','within','inner','deep','deeper','beneath','below','underground','buried','hidden','behind','under','core','center','heart','mind','brain','skull','bone','soul','spirit'],
    exterior: ['outside','outer','surface','above','sky','horizon','sea','ocean','mountain','field','world','earth','space','universe','cosmos','air','wild','landscape'],
    boundary: ['wall','walls','door','gate','window','border','edge','edges','line','lines','fence','cage','box','frame','curtain','mask','masks','skin','shell','mirror','glass','barrier'],
    scale: ['small','tiny','big','huge','vast','infinite','infinity','everything','nothing','whole','billion','million','zero','empty','full'],
  },
  temporal: {
    past: ['remember','memory','memories','ago','before','once','history','ancient','old','yesterday','childhood','young','grew','lost','gone','forgot','forgotten','regret'],
    present: ['now','here','today','moment','present','alive','living','breathing','existing','real','reality','immediate'],
    future: ['tomorrow','future','someday','coming','next','forward','ahead','dream','dreams','dreaming','hope','wish','imagine','vision','promise','becoming','potential'],
    cycle: ['again','return','repeat','cycle','circles','loop','spiral','season','seasons','rebirth','reborn','eternal','forever','begin','beginning','end','ending'],
  },
  existential: {
    self: ['myself','self','identity','person','human','being','exist','existence','conscious','ego','persona','character','role','face','reflection','authentic'],
    creation: ['create','creating','creation','build','building','craft','art','artist','paint','write','writing','compose','design','invent','manifest','birth','born'],
    destruction: ['destroy','die','dying','death','dead','kill','burn','bury','grave','ash','ashes','dust','ruin','decay','rot','waste','wither','fade','fading','vanish'],
    meaning: ['meaning','purpose','truth','true','faith','believe','belief','god','gods','divine','sacred','holy','prayer','soul','spirit','spiritual','transcend','wisdom','question','answer','seeking','search','journey'],
  },
};

function computeSignature(text) {
  if (!text || text.length < 30) return null;
  const words = text.toLowerCase().replace(/[^a-z'\s-]/g, ' ').split(/\s+/);
  if (words.length < 10) return null;
  const total = words.length;
  const sig = {};
  for (const [lens, dims] of Object.entries(LENSES)) {
    sig[lens] = {};
    let lt = 0;
    for (const [dim, lex] of Object.entries(dims)) {
      const hits = words.filter(w => lex.includes(w)).length;
      sig[lens][dim] = { hits, density: hits / total };
      lt += hits;
    }
    sig[lens]._total = lt;
    sig[lens]._density = lt / total;
    // dominant dimension
    const ranked = Object.entries(sig[lens]).filter(([k]) => !k.startsWith('_')).sort((a,b) => b[1].density - a[1].density);
    sig[lens]._dominant = ranked[0]?.[0] || null;
  }
  // Structural features
  const lines = text.split('\n').filter(l => l.trim());
  const lens = lines.map(l => l.trim().length);
  const avg = lens.reduce((a,b)=>a+b,0) / Math.max(lens.length,1);
  const variance = lens.reduce((s,l)=>s+Math.pow(l-avg,2),0) / Math.max(lens.length,1);
  sig._structure = { lineCount: lines.length, avgLen: Math.round(avg), variance: Math.round(variance),
    rhythm: variance < 200 ? 'tight' : variance < 800 ? 'moderate' : 'free' };
  return sig;
}

function compareSignatures(sA, sB) {
  if (!sA || !sB) return null;
  let totalScore = 0;
  const resonances = [];
  for (const [lens, dims] of Object.entries(LENSES)) {
    let dot = 0, mA = 0, mB = 0;
    for (const dim of Object.keys(dims)) {
      const dA = sA[lens][dim].density, dB = sB[lens][dim].density;
      dot += dA * dB; mA += dA * dA; mB += dB * dB;
    }
    const mag = Math.sqrt(mA) * Math.sqrt(mB);
    const sim = mag > 0 ? dot / mag : 0;
    if (sim > 0.7 && sA[lens]._total >= 2 && sB[lens]._total >= 2 && sA[lens]._density >= 0.015 && sB[lens]._density >= 0.015) {
      const domA = sA[lens]._dominant, domB = sB[lens]._dominant;
      const note = domA === domB ? `shared ${domA}` : `${domA} ↔ ${domB}`;
      resonances.push({ lens, sim: Math.round(sim * 100), note });
      totalScore += sim;
    }
  }
  // Structural bonus
  if (sA._structure && sB._structure && sA._structure.rhythm === sB._structure.rhythm && resonances.length > 0) {
    resonances.push({ lens: 'structural', sim: 30, note: `both ${sA._structure.rhythm} rhythm` });
    totalScore += 0.15;
  }
  if (resonances.length < 2 || totalScore < 1.5) return null;
  const ctx = resonances.map(r => `${r.lens}(${r.sim}%: ${r.note})`).join(' · ');
  return { score: totalScore, count: resonances.length, context: `Synesthetic: ${ctx}` };
}

// ===== LOAD =====
console.log('Loading...');
const catalog = loadJsonDir(CATALOG_DIR);
const writings = loadJsonDir(WRITINGS_DIR);
let changelog = [];
if (fs.existsSync(CHANGELOG)) { try { changelog = JSON.parse(fs.readFileSync(CHANGELOG,'utf-8')); } catch(e){} }
console.log(`  ${catalog.length} catalog, ${writings.length} writings, ${changelog.length} changelog`);

// ===== TRIAGE =====
console.log('\nTriaging writings...');
const triaged = {};
const triageCounts = {};
for (const w of writings) {
  const r = triageWriting(w);
  triaged[w.slug] = r;
  triageCounts[r.cls] = (triageCounts[r.cls] || 0) + 1;
}
for (const [c, n] of Object.entries(triageCounts).sort((a,b)=>b[1]-a[1])) console.log(`  ${c}: ${n}`);
const EXCLUDED = new Set(['scaffold', 'metadata-only']);
const DEMOTED = new Set(['daily-note', 'variant']);

// ===== BUILD NODES =====
const nodes = [], nodeMap = {};
function addNode(n) { if (nodeMap[n.id]) return; nodeMap[n.id] = n; nodes.push(n); }

for (const entry of catalog) {
  const mm = { 'visual-art':'visual','music':'audio','digital-glitch':'visual','digital-pixel':'visual','video-glitch':'video' };
  const type = mm[entry.medium] || (entry.medium === 'music' ? 'audio' : 'visual');
  const isColl = entry.collection && entry.collection.type === 'series';
  addNode({ id: entry.id, type: isColl ? 'collection' : (entry.products ? 'product' : type),
    title: entry.title, url: entry.products ? `/product/${entry.id}` : null,
    surface: { thumbnail:null, preview: entry.description||'', medium: entry.medium||'unknown', accent:null },
    semantic: { tags: entry.tags||[], themes:[], temporalAnchor: entry.created||null, provenance: entry.provenance ? entry.provenance.method : 'unknown' },
  });
}
for (const w of writings) {
  const fl = (w.body||'').split('\n').find(l=>l.trim()) || '';
  const t = triaged[w.slug];
  addNode({ id: w.slug, type: 'writing',
    title: `${w.title}${w.type==='lyrics'?' (lyrics)':''}`, url: `/writings/${w.slug}`,
    surface: { thumbnail:null, preview: fl.slice(0,80), medium: w.type||'writing', accent:null },
    semantic: { tags: w.tags||[], themes:[], temporalAnchor: w.date||null, provenance:'hand-written' },
    triage: { classification: t.cls, reason: t.why },
  });
}

// ===== EDGES =====
const edges = [], edgeSet = new Set();
function addEdge(e) { const k=[e.source,e.target,e.type].sort().join('::'); if(edgeSet.has(k))return; edgeSet.add(k); edges.push(e); }
console.log('\nDiscovering edges...');

// Pass 1: Catalog relations
for (const entry of catalog) {
  for (const rel of (entry.relations||[])) {
    if (nodeMap[rel.id]) addEdge({ source:entry.id, target:rel.id, type:rel.type||'pairs-with',
      weight:1.0, origin:'authored', confidence:1.0, discoveredAt:now,
      context:`Catalog: ${rel.type||'pairs-with'}`, bidirectional:true });
  }
}
console.log(`  Pass 1 (catalog relations): ${edges.length} edges`);

// Pass 2: Title matching
let pc2 = edges.length;
for (const entry of catalog) {
  if (entry.medium !== 'music') continue;
  const bn = slugify(entry.title);
  for (const w of writings) {
    if (w.type !== 'lyrics') continue;
    if (bn === slugify(w.title)) addEdge({ source:entry.id, target:w.slug, type:'lyrics-for',
      weight:0.95, origin:'catalog', confidence:0.9, discoveredAt:now,
      context:`Title match: "${entry.title}" ↔ "${w.title}"`, bidirectional:true });
  }
}
console.log(`  Pass 2 (title matching): ${edges.length-pc2} new`);

// Pass 3: Temporal proximity
let pc3 = edges.length;
const byMonth = {};
for (const n of nodes) { const mk = monthKey(n.semantic?.temporalAnchor); if(!mk)continue; if(!byMonth[mk])byMonth[mk]=[]; byMonth[mk].push(n.id); }
for (const [month, ids] of Object.entries(byMonth)) {
  if (ids.length < 2) continue;
  for (let i=0;i<ids.length;i++) for (let j=i+1;j<ids.length;j++)
    addEdge({ source:ids[i], target:ids[j], type:'temporal-proximity', weight:0.4, origin:'temporal',
      confidence:0.7, discoveredAt:now, context:`Same month: ${month}`, bidirectional:true });
}
console.log(`  Pass 3 (temporal proximity): ${edges.length-pc3} new`);

// Pass 4: Tag overlap
let pc4 = edges.length;
for (let i=0;i<nodes.length;i++) for (let j=i+1;j<nodes.length;j++) {
  const a=nodes[i], b=nodes[j], ov = tagOverlap(a.semantic?.tags, b.semantic?.tags);
  if (ov >= 2) {
    const shared = (a.semantic?.tags||[]).filter(t=>(b.semantic?.tags||[]).includes(t));
    addEdge({ source:a.id, target:b.id, type:'shared-theme', weight:Math.min(0.3+ov*0.15,0.85),
      origin:'semantic', confidence:0.6, discoveredAt:now, context:`Tags: ${shared.join(', ')}`, bidirectional:true });
  }
}
console.log(`  Pass 4 (tag overlap): ${edges.length-pc4} new`);

// Pass 5: Variant linking
let pc5 = edges.length;
for (const w of writings) {
  const m = w.slug.match(/^(.+)-(\d+)$/);
  if (m && nodeMap[m[1]] && nodeMap[w.slug])
    addEdge({ source:m[1], target:w.slug, type:'forked-from', weight:0.9, origin:'structural',
      confidence:0.95, discoveredAt:now, context:`Variant: "${m[1]}" ↔ "${w.slug}"`, bidirectional:true });
}
console.log(`  Pass 5 (variant linking): ${edges.length-pc5} new`);

// Pass 6: Synesthetic analysis — multi-lens resonance
// Reads each writing through 6 perceptual lenses and finds pairs that resonate
// across 2+ modalities. Triage-excluded nodes are skipped; demoted nodes get
// a confidence penalty. Clear provenance in every edge context string.
let pc6 = edges.length;
const sigs = {};
let sigN = 0;
for (const w of writings) {
  const t = triaged[w.slug];
  if (EXCLUDED.has(t.cls)) continue;
  const txt = t.clean || w.body || '';
  const sig = computeSignature(txt);
  if (sig) { sigs[w.slug] = { sig, cls: t.cls }; sigN++; }
}
console.log(`  Signatures: ${sigN} writings`);

const slugList = Object.keys(sigs);
for (let i = 0; i < slugList.length; i++) {
  for (let j = i + 1; j < slugList.length; j++) {
    const sA = slugList[i], sB = slugList[j];
    if (sA.replace(/-\d+$/,'') === sB.replace(/-\d+$/,'')) continue; // skip variant pairs
    const result = compareSignatures(sigs[sA].sig, sigs[sB].sig);
    if (!result) continue;
    let confMod = 1.0;
    if (DEMOTED.has(sigs[sA].cls)) confMod *= 0.6;
    if (DEMOTED.has(sigs[sB].cls)) confMod *= 0.6;
    const weight = Math.min(0.15 + result.score * 0.12, 0.55);
    const confidence = Math.round(Math.min(0.25 + result.count * 0.08, 0.5) * confMod * 100) / 100;
    addEdge({ source:sA, target:sB, type:'semantic-echo', weight, origin:'ai-shadow',
      confidence, discoveredAt:now, context:result.context, bidirectional:true });
  }
}
console.log(`  Pass 6 (synesthetic): ${edges.length-pc6} new`);

// ===== OUTPUT =====
const graph = {
  meta: { version:'0.4.0',
    description:'deaconstruckdead graph — triage-filtered, synesthetic multi-lens analysis',
    lastCompiled:now, nodeCount:nodes.length, edgeCount:edges.length,
    sources: { catalog:catalog.length, writings:writings.length, changelog:changelog.length },
    triage: triageCounts },
  nodes, edges,
};
fs.writeFileSync(OUTPUT, JSON.stringify(graph, null, 2), 'utf-8');
console.log(`\nCompiled: ${nodes.length} nodes, ${edges.length} edges → ${OUTPUT}`);

// ===== HEALTH REPORT =====
const conn = new Set();
for (const e of edges) { conn.add(e.source); conn.add(e.target); }
const orphans = nodes.filter(n => !conn.has(n.id));
const et = {};
for (const e of edges) { et[e.type] = (et[e.type]||0)+1; }
console.log(`\nHealth:`);
console.log(`  Orphans: ${orphans.length}/${nodes.length}`);
if (orphans.length <= 20) orphans.forEach(o => {
  const tc = o.triage ? ` [${o.triage.classification}]` : '';
  console.log(`    ${o.id} (${o.type})${tc}`);
});
console.log(`  Edges:`);
for (const [t,c] of Object.entries(et).sort((a,b)=>b[1]-a[1])) console.log(`    ${t}: ${c}`);
console.log(`  Triage:`);
for (const [c,n] of Object.entries(triageCounts).sort((a,b)=>b[1]-a[1])) console.log(`    ${c}: ${n}`);
