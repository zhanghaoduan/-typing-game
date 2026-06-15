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
    const lines = t.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (lines.length === 0) return '';
    // ECDICT often has multiple definition lines, e.g.:
    //   难忘
    //   a. 难忘的
    // Prefer lines starting with a POS marker (n. / v. / a. / adj. / adv. / vt. / vi. / prep. / conj.)
    const posRe = /^(n|v|a|adj|adv|vt|vi|prep|conj|pron|art|num|aux|int)\.\s*/i;
    const withPos = lines.filter(l => posRe.test(l));
    let chosen;
    if (withPos.length > 0) {
        // Join up to 3 POS-tagged lines for richer meaning
        chosen = withPos.slice(0, 3).join('; ');
    } else {
        // No POS markers — take up to first 2 lines
        chosen = lines.slice(0, 2).join('; ');
    }
    chosen = chosen.replace(/\s*\([^)]*\)\s*$/, '').trim();
    chosen = chosen.replace(/\s+/g, ' ');
    return chosen;
}

const dict = {};
let dropped = 0;
for (const r of rows) {
    if (!r.word || !r.translation) { dropped++; continue; }
    const key = r.word.toLowerCase().trim();
    if (!key) { dropped++; continue; }
    const val = clean(r.translation);
    if (!val) { dropped++; continue; }
    if (!dict[key]) dict[key] = val;
}

fs.writeFileSync(OUT, JSON.stringify(dict));
const stat = fs.statSync(OUT);
console.log(`Wrote ${Object.keys(dict).length} entries (${(stat.size/1024).toFixed(1)} KB) to ${OUT}`);
console.log(`Dropped ${dropped} invalid rows.`);
