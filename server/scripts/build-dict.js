#!/usr/bin/env node
// Build a local English→Chinese dictionary from ECDICT, filtered by exam tags.
// Tags included: zk (中考), gk (高考), cet4, cet6, ky (考研).
// Also emits a per-grade level dictionary (小学/初中/高中/大学) for difficulty practice.
// Usage:  node server/scripts/build-dict.js
// Output: server/dict/textbook_dict.json, server/dict/level_dict.json

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DICT_URL = 'https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-sqlite-28.zip';
const TMP = '/tmp/ecdict-build';
const OUT_DIR = path.join(__dirname, '..', 'dict');
const OUT = path.join(OUT_DIR, 'textbook_dict.json');
const LEVEL_OUT = path.join(OUT_DIR, 'level_dict.json');

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
    SELECT word, translation, tag, oxford, collins, frq, exchange
    FROM stardict
    WHERE translation IS NOT NULL AND translation != ''
      AND (
            tag LIKE '%zk%'
         OR tag LIKE '%gk%'
         OR tag LIKE '%cet4%'
         OR tag LIKE '%cet6%'
         OR tag LIKE '%ky%'
         OR tag LIKE '%ielts%'
         OR tag LIKE '%toefl%'
         OR tag LIKE '%gre%'
         OR collins >= 1
         OR oxford >= 1
         OR (frq IS NOT NULL AND frq > 0 AND frq <= 20000)
      )
`).all();

function clean(t) {
    if (!t) return '';
    const lines = t.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (lines.length === 0) return '';
    const posRe = /^(n|v|a|adj|adv|vt|vi|prep|conj|pron|art|num|aux|int)\.\s*/i;
    const withPos = lines.filter(l => posRe.test(l));
    let chosen;
    if (withPos.length > 0) {
        chosen = withPos.slice(0, 3).join('; ');
    } else {
        chosen = lines.slice(0, 2).join('; ');
    }
    chosen = chosen.replace(/\s*\([^)]*\)\s*$/, '').trim();
    chosen = chosen.replace(/\s+/g, ' ');
    return chosen;
}

// A shorter translation (single sense, no POS noise) for the practice card UI
function shortClean(t) {
    const c = clean(t);
    if (!c) return '';
    // Take only first POS group, first 2 senses, drop POS prefix for compactness
    const firstGroup = c.split(';')[0].trim();
    const noPos = firstGroup.replace(/^(n|v|a|adj|adv|vt|vi|prep|conj|pron|art|num|aux|int)\.\s*/i, '');
    const senses = noPos.split(/[,，]/).map(s => s.trim()).filter(Boolean).slice(0, 2);
    return senses.join('，');
}

// Determine grade level (1=小学, 2=初中, 3=高中, 4=大学, 0=skip)
function gradeOf(r) {
    const tag = r.tag || '';
    const word = r.word.trim();
    if (!/^[a-z]+(?:[a-z'-]*[a-z])?$/i.test(word)) return 0;        // skip multi-token, hyphenated edge
    if (word.length < 2) return 0;
    // exchange field marks derived forms (e.g., "p:past 0:base..."). Prefer base forms only for level dict.
    const isDerived = (r.exchange || '').includes('0:');             // has a base form pointer → it's a derived form
    if (isDerived) return 0;

    // 小学: very common, oxford-tagged, short, high-frequency
    if (r.oxford >= 1 && r.frq && r.frq > 0 && r.frq <= 8000 && word.length <= 9) return 1;
    // 初中
    if (/\bzk\b/.test(tag)) return 2;
    // 高中
    if (/\bgk\b/.test(tag)) return 3;
    // 大学
    if (/\b(cet4|cet6|ky)\b/.test(tag)) return 4;
    return 0;
}

const dict = {};
const levelDict = { 1: [], 2: [], 3: [], 4: [] };
const seenInLevel = new Set();
let dropped = 0;

for (const r of rows) {
    if (!r.word || !r.translation) { dropped++; continue; }
    const key = r.word.toLowerCase().trim();
    if (!key) { dropped++; continue; }
    const val = clean(r.translation);
    if (!val) { dropped++; continue; }
    if (!dict[key]) dict[key] = val;

    const lv = gradeOf(r);
    if (lv >= 1 && lv <= 4 && !seenInLevel.has(key)) {
        const cn = shortClean(r.translation);
        if (cn) {
            levelDict[lv].push({ en: key, cn });
            seenInLevel.add(key);
        }
    }
}

fs.writeFileSync(OUT, JSON.stringify(dict));
const stat = fs.statSync(OUT);
console.log(`Wrote ${Object.keys(dict).length} entries (${(stat.size/1024).toFixed(1)} KB) to ${OUT}`);
console.log(`Dropped ${dropped} invalid rows.`);

fs.writeFileSync(LEVEL_OUT, JSON.stringify(levelDict));
const lstat = fs.statSync(LEVEL_OUT);
console.log(`Wrote level dict (${(lstat.size/1024).toFixed(1)} KB) to ${LEVEL_OUT}`);
console.log(`  小学 lv1: ${levelDict[1].length} | 初中 lv2: ${levelDict[2].length} | 高中 lv3: ${levelDict[3].length} | 大学 lv4: ${levelDict[4].length}`);
