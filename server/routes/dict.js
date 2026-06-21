const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');

const router = express.Router();

const STAR_PATH = path.join(__dirname, '..', 'dict', 'stardict.db');
let starDb = null;
let lookupStmt = null;

function ensureDb() {
    if (starDb) return starDb;
    if (!fs.existsSync(STAR_PATH)) return null;
    try {
        const Database = require('better-sqlite3');
        starDb = new Database(STAR_PATH, { readonly: true, fileMustExist: true });
        lookupStmt = starDb.prepare(
            'SELECT word, phonetic, definition, translation, exchange, tag FROM stardict WHERE word = ? COLLATE NOCASE LIMIT 1'
        );
        console.log('[dict] stardict.db loaded for /api/dict/lookup');
        return starDb;
    } catch (err) {
        console.warn('[dict] failed to open stardict.db:', err.message);
        return null;
    }
}
ensureDb();

function cleanTranslation(t) {
    if (!t) return '';
    return String(t).split(/\r?\n/).map(s => s.trim()).filter(Boolean).join('；');
}

function cleanDefinition(d) {
    if (!d) return '';
    const lines = String(d).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    // Cap to first 3 lines for readability
    return lines.slice(0, 3).join(' / ');
}

// Parse exchange "p:past q:past_p i:ing 3:third_p s:plural 0:base 1:lemma_form"
function parseExchange(ex) {
    if (!ex) return null;
    const parts = String(ex).split('/');
    const map = {};
    for (const p of parts) {
        const [k, v] = p.split(':');
        if (k && v) map[k.trim()] = v.trim();
    }
    return map;
}

function lookupWord(word) {
    const db = ensureDb();
    if (!db) return null;
    const w = String(word || '').trim();
    if (!w) return null;
    let row = lookupStmt.get(w);
    if (!row) {
        // Try lemma via exchange "0:" — query the word itself's exchange
        // We can't easily reverse-lookup without scanning; try common morphology.
        const lower = w.toLowerCase();
        const variants = [
            lower.replace(/ies$/, 'y'),
            lower.replace(/ied$/, 'y'),
            lower.replace(/es$/, ''),
            lower.replace(/s$/, ''),
            lower.replace(/ed$/, ''),
            lower.replace(/ed$/, 'e'),
            lower.replace(/ing$/, ''),
            lower.replace(/ing$/, 'e'),
            lower.replace(/ly$/, ''),
        ].filter((v, i, a) => v && v !== lower && a.indexOf(v) === i);
        for (const v of variants) {
            row = lookupStmt.get(v);
            if (row) break;
        }
    }
    if (!row) return null;
    return {
        word: row.word,
        phonetic: row.phonetic || '',
        translation: cleanTranslation(row.translation),
        definition: cleanDefinition(row.definition),
        exchange: parseExchange(row.exchange)
    };
}

// GET /api/dict/lookup?word=X  → { found, word, phonetic, translation, definition, exchange }
router.get('/lookup', (req, res) => {
    const word = String(req.query.word || '').trim();
    if (!word) return res.status(400).json({ error: 'word required' });
    if (word.length > 64) return res.status(400).json({ error: 'word too long' });
    const data = lookupWord(word);
    if (!data) return res.json({ found: false, query: word });
    res.json({ found: true, query: word, ...data });
});

// POST /api/dict/lookup  body: { words: ['a','b'] } → batched
router.post('/lookup', (req, res) => {
    const words = Array.isArray(req.body && req.body.words) ? req.body.words : [];
    const out = {};
    for (const raw of words.slice(0, 50)) {
        const w = String(raw || '').trim();
        if (!w) continue;
        const data = lookupWord(w);
        out[w] = data ? { found: true, ...data } : { found: false };
    }
    res.json({ results: out });
});

// ---- Online example sentences (Youdao public endpoint, cached in DB) ----

const getExCache = db.prepare(
    "SELECT examples_json, fetched_at FROM example_cache WHERE word = ? AND fetched_at > datetime('now', '-30 days')"
);
const putExCache = db.prepare(
    'INSERT OR REPLACE INTO example_cache (word, examples_json, fetched_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
);

function stripTags(s) {
    return String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

async function fetchWithTimeout(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
        return await fetch(url, {
            signal: ctrl.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
                'Referer': 'https://dict.youdao.com/'
            }
        });
    } finally { clearTimeout(t); }
}

async function fetchYoudaoExamples(word) {
    const url = `https://dict.youdao.com/jsonapi_s?q=${encodeURIComponent(word)}&doctype=json&jsonversion=4`;
    const res = await fetchWithTimeout(url, 6000);
    if (!res.ok) return [];
    let data;
    try { data = await res.json(); } catch (_) { return []; }

    const out = [];
    const bp = data && data.blng_sents_part;
    if (bp && Array.isArray(bp['sentence-pair'])) {
        for (const p of bp['sentence-pair']) {
            const en = stripTags(p.sentence || p['sentence-eng'] || '');
            const cn = stripTags(p['sentence-translation'] || '');
            if (en && cn) out.push({ en, cn });
            if (out.length >= 3) break;
        }
    }
    return out;
}

async function getExamples(word) {
    const key = String(word || '').trim().toLowerCase();
    if (!key) return [];
    const cached = getExCache.get(key);
    if (cached && cached.examples_json) {
        try { return JSON.parse(cached.examples_json); } catch (_) {}
    }
    let examples = [];
    try { examples = await fetchYoudaoExamples(key); } catch (_) {}
    try { putExCache.run(key, JSON.stringify(examples)); } catch (_) {}
    return examples;
}

// GET /api/dict/examples?word=X  → { word, examples: [{en, cn}, ...] }
router.get('/examples', async (req, res) => {
    const word = String(req.query.word || '').trim();
    if (!word) return res.status(400).json({ error: 'word required' });
    if (word.length > 64) return res.status(400).json({ error: 'word too long' });
    try {
        const examples = await getExamples(word);
        res.json({ word, examples });
    } catch (err) {
        res.json({ word, examples: [] });
    }
});

// POST /api/dict/examples  body: { words: [...] }
router.post('/examples', async (req, res) => {
    const words = Array.isArray(req.body && req.body.words) ? req.body.words : [];
    const out = {};
    await Promise.all(words.slice(0, 10).map(async (raw) => {
        const w = String(raw || '').trim();
        if (!w) return;
        try { out[w] = await getExamples(w); }
        catch (_) { out[w] = []; }
    }));
    res.json({ results: out });
});

module.exports = router;
module.exports.lookupWord = lookupWord;
module.exports.getExamples = getExamples;
