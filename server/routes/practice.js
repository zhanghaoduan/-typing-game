const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const LEVEL_DICT_PATH = path.join(__dirname, '..', 'dict', 'level_dict.json');
let LEVEL_DICT = { 1: [], 2: [], 3: [], 4: [] };

function loadLevelDict() {
    try {
        if (fs.existsSync(LEVEL_DICT_PATH)) {
            const raw = fs.readFileSync(LEVEL_DICT_PATH, 'utf8');
            LEVEL_DICT = JSON.parse(raw);
            const sizes = [1, 2, 3, 4].map(k => (LEVEL_DICT[k] || []).length).join(' / ');
            console.log(`[practice] loaded level dict: lv1/2/3/4 = ${sizes}`);
        } else {
            console.warn('[practice] level_dict.json not found at', LEVEL_DICT_PATH);
        }
    } catch (e) {
        console.error('[practice] failed to load level dict:', e.message);
    }
}
loadLevelDict();

function pickRandom(arr, n) {
    const out = [];
    const len = arr.length;
    if (len === 0) return out;
    const used = new Set();
    const k = Math.min(n, len);
    while (out.length < k) {
        const idx = Math.floor(Math.random() * len);
        if (used.has(idx)) continue;
        used.add(idx);
        out.push(arr[idx]);
    }
    return out;
}

// GET /api/practice/random?level=1|2|3|4&count=20
router.get('/random', (req, res) => {
    const level = parseInt(req.query.level, 10);
    const count = Math.max(1, Math.min(50, parseInt(req.query.count, 10) || 15));

    if (![1, 2, 3, 4].includes(level)) {
        return res.status(400).json({ error: 'level must be 1|2|3|4' });
    }

    const pool = LEVEL_DICT[level] || [];
    if (pool.length === 0) {
        return res.status(503).json({ error: 'level dict not available; run build-dict.js' });
    }

    const items = pickRandom(pool, count).map(it => ({
        type: 'word',
        en: it.en,
        cn: it.cn,
        difficulty: level
    }));

    res.json({ level, count: items.length, items });
});

// GET /api/practice/levels — meta info for the difficulty picker
router.get('/levels', (req, res) => {
    const sizes = [1, 2, 3, 4].map(k => (LEVEL_DICT[k] || []).length);
    res.json({
        levels: [
            { id: 1, key: 'xiaoxue',  nameCN: '小学', nameEN: 'Primary',     count: sizes[0] },
            { id: 2, key: 'chuzhong', nameCN: '初中', nameEN: 'Junior High', count: sizes[1] },
            { id: 3, key: 'gaozhong', nameCN: '高中', nameEN: 'Senior High', count: sizes[2] },
            { id: 4, key: 'daxue',    nameCN: '大学', nameEN: 'University',  count: sizes[3] }
        ]
    });
});

module.exports = router;
