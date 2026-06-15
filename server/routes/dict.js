const express = require('express');
const fs = require('fs');
const path = require('path');

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

module.exports = router;
