#!/usr/bin/env node
// Build a local English→Chinese dictionary from ECDICT, filtered by exam tags.
// Tags included: zk (中考), gk (高考), cet4, cet6, ky (考研).
// Usage:  node server/scripts/build-dict.js
// Output: server/dict/textbook_dict.json

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DICT_URL = 'https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-sqlite-28.zip';
const TMP = '/tmp/ecdict-build';
const OUT_DIR = path.join(__dirname, '..', 'dict');
const OUT = path.join(OUT_DIR, 'textbook_dict.json');

function sh(cmd) {
    console.log('> ' + cmd);
    const r = spawnSync('bash', ['-c', cmd], { stdio: 'inherit' });
    if (r.status !== 0) { console.error('Command failed'); process.exit(r.status || 1); }
}

fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const dbPath = path.join(TMP, 'stardict.db');
if (!fs.existsSync(dbPath)) {
    sh(`cd ${TMP} && wget -q --show-progress '${DICT_URL}' -O ecdict.zip && unzip -o ecdict.zip`);
}
if (!fs.existsSync(dbPath)) {
    console.error('stardict.db not found after extraction. Looking for alternative names...');
    const files = fs.readdirSync(TMP);
    console.error('Files in tmp:', files);
    const sq = files.find(f => f.endsWith('.db'));
    if (!sq) process.exit(1);
    fs.renameSync(path.join(TMP, sq), dbPath);
}

const Database = require('better-sqlite3');
const db = new Database(dbPath, { readonly: true });

const rows = db.prepare(`
    SELECT word, translation, tag
    FROM stardict
    WHERE tag LIKE '%zk%'
       OR tag LIKE '%gk%'
       OR tag LIKE '%cet4%'
       OR tag LIKE '%cet6%'
       OR tag LIKE '%ky%'
`).all();

function clean(t) {
    if (!t) return '';
    // Take first line, strip trailing "(xxx)" annotations like "(spirit的复数)"
    let line = t.split(/\r?\n/)[0].trim();
    line = line.replace(/\s*\([^)]*\)\s*$/, '').trim();
    // Collapse repeated whitespace
    line = line.replace(/\s+/g, ' ');
    return line;
}

const dict = {};
let dropped = 0;
for (const r of rows) {
    if (!r.word || !r.translation) { dropped++; continue; }
    const key = r.word.toLowerCase().trim();
    if (!key) { dropped++; continue; }
    const val = clean(r.translation);
    if (!val) { dropped++; continue; }
    if (!dict[key] || val.length < dict[key].length) dict[key] = val;
}

fs.writeFileSync(OUT, JSON.stringify(dict));
const stat = fs.statSync(OUT);
console.log(`Wrote ${Object.keys(dict).length} entries (${(stat.size/1024).toFixed(1)} KB) to ${OUT}`);
console.log(`Dropped ${dropped} invalid rows.`);
