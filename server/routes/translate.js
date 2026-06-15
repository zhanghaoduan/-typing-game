const express = require('express');
const db = require('../db');

const router = express.Router();

const getCached = db.prepare('SELECT zh_text FROM translation_cache WHERE en_text = ?');
const putCached = db.prepare('INSERT OR REPLACE INTO translation_cache (en_text, zh_text) VALUES (?, ?)');

// MyMemory translation API: free, no key, ~50k chars/day per IP with email
// https://mymemory.translated.net/doc/spec.php
const EMAIL_PARAM = process.env.MYMEMORY_EMAIL || 'translate@zhanghaoduan.cn';

function normalizeKey(text) {
    return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function translateOne(text) {
    const key = normalizeKey(text);
    if (!key) return '';
    const cached = getCached.get(key);
    if (cached) return cached.zh_text;

    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-CN&de=${encodeURIComponent(EMAIL_PARAM)}`;
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) return '';
        const data = await res.json();
        let zh = (data && data.responseData && data.responseData.translatedText) || '';
        zh = String(zh).trim();
        // MyMemory sometimes returns the original English on failure; treat as empty
        if (!zh || zh.toLowerCase() === text.toLowerCase()) return '';
        // Skip obvious quota / error messages
        if (/QUERY LENGTH LIMIT|MYMEMORY WARNING|INVALID/i.test(zh)) return '';
        putCached.run(key, zh);
        return zh;
    } catch (err) {
        console.warn('[translate] failed for:', text, err.message);
        return '';
    }
}

// Limited-concurrency map
async function pMapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let i = 0;
    async function worker() {
        while (i < items.length) {
            const idx = i++;
            results[idx] = await fn(items[idx], idx);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

// POST /api/translate  body: { texts: ["spirits", "have fun", ...] }
// returns: { translations: { "spirits": "精神", ... } }
router.post('/', async (req, res) => {
    try {
        const texts = Array.isArray(req.body && req.body.texts) ? req.body.texts : [];
        const unique = [];
        const seen = new Set();
        for (const t of texts) {
            const s = String(t || '').trim();
            if (!s) continue;
            const k = normalizeKey(s);
            if (seen.has(k)) continue;
            seen.add(k);
            unique.push(s);
        }
        if (unique.length === 0) return res.json({ translations: {} });
        if (unique.length > 200) return res.status(400).json({ error: 'too many texts (max 200)' });

        const zhs = await pMapLimit(unique, 4, translateOne);
        const translations = {};
        unique.forEach((t, i) => { translations[t] = zhs[i] || ''; });
        res.json({ translations });
    } catch (err) {
        console.error('[translate] error:', err);
        res.status(500).json({ error: 'translation failed' });
    }
});

module.exports = router;
