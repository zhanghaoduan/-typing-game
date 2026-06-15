const express = require('express');
const db = require('../db');

const router = express.Router();

const getCached = db.prepare('SELECT zh_text FROM translation_cache WHERE en_text = ?');
const putCached = db.prepare('INSERT OR REPLACE INTO translation_cache (en_text, zh_text) VALUES (?, ?)');
const deleteCached = db.prepare('DELETE FROM translation_cache WHERE en_text = ?');

const EMAIL_PARAM = process.env.MYMEMORY_EMAIL || 'translate@zhanghaoduan.cn';

function normalizeKey(text) {
    return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Reject obviously bad translations (URLs, mostly digits, mostly English letters, error messages)
function isBadTranslation(zh, src) {
    if (!zh) return true;
    const t = zh.trim();
    if (!t) return true;
    // Contains URLs
    if (/https?:\/\//i.test(t)) return true;
    // MyMemory error messages
    if (/QUERY LENGTH|MYMEMORY WARNING|INVALID|PLEASE SELECT|TRANSLATIONS LIMIT/i.test(t)) return true;
    // Pure digits / numbers with separators (e.g., "72,013")
    if (/^[\d.,\s%+\-]+$/.test(t)) return true;
    // Same as source (case-insensitive)
    if (src && t.toLowerCase() === src.toLowerCase()) return true;
    // Should contain at least one CJK character if the source is English
    const cjkCount = (t.match(/[\u4e00-\u9fff]/g) || []).length;
    if (cjkCount === 0) return true;
    // Mostly Latin letters with little CJK — likely junk (e.g., "adj. 青年" is ok, "法-奥廷怪物" has CJK so it passes — see length filter below)
    // Result wildly longer than source for short inputs is suspicious
    const srcWords = src.trim().split(/\s+/).length;
    if (srcWords === 1 && t.length > 12) return true;
    return false;
}

async function fetchWithTimeout(url, ms = 7000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        return await fetch(url, {
            signal: ctrl.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 typing-game-translator' }
        });
    } finally {
        clearTimeout(timer);
    }
}

// Google Translate's public gtx endpoint (no key required)
async function translateViaGoogle(text) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetchWithTimeout(url, 7000);
    if (!res.ok) return '';
    const data = await res.json();
    // data[0] is an array of [translated, original, ...] chunks; concatenate translations
    if (!Array.isArray(data) || !Array.isArray(data[0])) return '';
    let out = '';
    for (const chunk of data[0]) {
        if (Array.isArray(chunk) && chunk[0]) out += chunk[0];
    }
    return out.trim();
}

// MyMemory free API as fallback
async function translateViaMyMemory(text) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-CN&de=${encodeURIComponent(EMAIL_PARAM)}`;
    const res = await fetchWithTimeout(url, 7000);
    if (!res.ok) return '';
    const data = await res.json();
    // Only accept if confidence is decent
    const match = (data && data.responseData && typeof data.responseData.match === 'number') ? data.responseData.match : 0;
    if (match < 0.6) return '';
    const zh = (data && data.responseData && data.responseData.translatedText) || '';
    return String(zh).trim();
}

async function translateOne(text) {
    const key = normalizeKey(text);
    if (!key) return '';
    const cached = getCached.get(key);
    if (cached) return cached.zh_text;

    // 1) Try Google first (higher quality)
    let zh = '';
    try { zh = await translateViaGoogle(text); } catch (e) { /* ignore */ }
    if (isBadTranslation(zh, text)) zh = '';

    // 2) Fall back to MyMemory
    if (!zh) {
        try { zh = await translateViaMyMemory(text); } catch (e) { /* ignore */ }
        if (isBadTranslation(zh, text)) zh = '';
    }

    if (zh) putCached.run(key, zh);
    return zh;
}

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

// One-time cleanup of bad cached translations on startup
function purgeBadCache() {
    try {
        const rows = db.prepare('SELECT en_text, zh_text FROM translation_cache').all();
        let removed = 0;
        for (const r of rows) {
            if (isBadTranslation(r.zh_text, r.en_text)) {
                deleteCached.run(r.en_text);
                removed++;
            }
        }
        if (removed > 0) console.log(`[translate] purged ${removed} bad cached translations`);
    } catch (err) {
        console.warn('[translate] purgeBadCache failed:', err.message);
    }
}
purgeBadCache();

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

