const express = require('express');
const db = require('../db');
const { authenticate } = require('../auth');

const router = express.Router();

const STAT_FIELDS = [
    'stars', 'coins', 'streak', 'last_play_date', 'levels_unlocked',
    'level_stars', 'level_scores', 'badges',
    'total_correct', 'total_attempts', 'total_words_typed',
    'games_played', 'max_combo', 'total_time_ms'
];

function ensureStatsRow(userId) {
    db.prepare('INSERT OR IGNORE INTO user_stats (user_id) VALUES (?)').run(userId);
}

function parseStatsRow(row) {
    if (!row) return null;
    const out = { ...row };
    try { out.level_stars = JSON.parse(row.level_stars || '{}'); } catch (e) { out.level_stars = {}; }
    try { out.level_scores = JSON.parse(row.level_scores || '{}'); } catch (e) { out.level_scores = {}; }
    try { out.badges = JSON.parse(row.badges || '[]'); } catch (e) { out.badges = []; }
    return out;
}

router.use(authenticate);

// GET /api/me/stats
router.get('/stats', (req, res) => {
    ensureStatsRow(req.user.id);
    const row = db.prepare('SELECT * FROM user_stats WHERE user_id = ?').get(req.user.id);
    res.json({ stats: parseStatsRow(row) });
});

// PUT /api/me/stats
router.put('/stats', (req, res) => {
    ensureStatsRow(req.user.id);
    const body = req.body || {};
    const values = {};
    for (const k of STAT_FIELDS) {
        if (body[k] === undefined) continue;
        if (k === 'level_stars' || k === 'level_scores' || k === 'badges') {
            values[k] = typeof body[k] === 'string' ? body[k] : JSON.stringify(body[k]);
        } else if (k === 'last_play_date') {
            values[k] = body[k] === null ? null : String(body[k]);
        } else {
            const n = Number(body[k]);
            values[k] = Number.isFinite(n) ? n : 0;
        }
    }
    const keys = Object.keys(values);
    if (keys.length === 0) {
        const row = db.prepare('SELECT * FROM user_stats WHERE user_id = ?').get(req.user.id);
        return res.json({ stats: parseStatsRow(row) });
    }
    const setSql = keys.map(k => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE user_stats SET ${setSql}, updated_at = CURRENT_TIMESTAMP WHERE user_id = @user_id`)
        .run({ ...values, user_id: req.user.id });
    const row = db.prepare('SELECT * FROM user_stats WHERE user_id = ?').get(req.user.id);
    res.json({ stats: parseStatsRow(row) });
});

// POST /api/me/practice
router.post('/practice', (req, res) => {
    const { kind, ref_id, score, stars, correct, attempts, duration_ms } = req.body || {};
    if (!kind) return res.status(400).json({ error: 'kind required' });
    db.prepare(`INSERT INTO practice_logs
        (user_id, kind, ref_id, score, stars, correct, attempts, duration_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        req.user.id,
        String(kind),
        ref_id == null ? null : String(ref_id),
        Number(score) || 0,
        Number(stars) || 0,
        Number(correct) || 0,
        Number(attempts) || 0,
        Number(duration_ms) || 0
    );
    const today = new Date().toISOString().slice(0, 10);
    db.prepare('INSERT OR IGNORE INTO login_days (user_id, date) VALUES (?, ?)').run(req.user.id, today);
    res.json({ success: true });
});

// GET /api/me/practice-history?limit=50
router.get('/practice-history', (req, res) => {
    let limit = parseInt(req.query.limit, 10) || 50;
    if (limit < 1) limit = 1;
    if (limit > 200) limit = 200;
    const rows = db.prepare(
        'SELECT id, kind, ref_id, score, stars, correct, attempts, duration_ms, created_at FROM practice_logs WHERE user_id = ? ORDER BY id DESC LIMIT ?'
    ).all(req.user.id, limit);
    res.json({ history: rows });
});

// GET /api/me/profile  — basic user fields (username, role, grade)
router.get('/profile', (req, res) => {
    const u = db.prepare('SELECT id, username, role, grade FROM users WHERE id = ?').get(req.user.id);
    if (!u) return res.status(404).json({ error: 'user not found' });
    res.json({ user: { id: u.id, username: u.username, role: u.role, grade: u.grade || '' } });
});

// PUT /api/me/profile  — update grade (only field for now)
router.put('/profile', (req, res) => {
    const { grade } = req.body || {};
    if (typeof grade !== 'string') {
        return res.status(400).json({ error: 'grade required' });
    }
    db.prepare('UPDATE users SET grade = ? WHERE id = ?').run(grade, req.user.id);
    const u = db.prepare('SELECT id, username, role, grade FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: { id: u.id, username: u.username, role: u.role, grade: u.grade || '' } });
});

module.exports = router;
