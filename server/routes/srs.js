const express = require('express');
const db = require('../db');
const { authenticate } = require('../auth');

const router = express.Router();
router.use(authenticate);

// Leitner-style intervals in minutes by level (0..5)
// 0=just-learned/wrong, 5=mastered
const INTERVAL_MIN = [5, 60, 24 * 60, 3 * 24 * 60, 7 * 24 * 60, 30 * 24 * 60];

function nextDueIso(level) {
    const mins = INTERVAL_MIN[Math.max(0, Math.min(5, level))];
    return new Date(Date.now() + mins * 60 * 1000).toISOString();
}

function nowIso() { return new Date().toISOString(); }

// POST /api/srs/answer  body: { en, cn?, correct, input? }
router.post('/answer', (req, res) => {
    const { en, cn, correct, input } = req.body || {};
    if (!en || typeof en !== 'string') {
        return res.status(400).json({ error: 'en required' });
    }
    const enLow = en.toLowerCase().trim();
    if (!enLow) return res.status(400).json({ error: 'en empty' });
    const isCorrect = !!correct;

    const existing = db.prepare(
        'SELECT * FROM word_progress WHERE user_id = ? AND en_word = ?'
    ).get(req.user.id, enLow);

    let level, correct_count, wrong_count, consecutive_correct;
    if (existing) {
        level = existing.level || 0;
        correct_count = existing.correct_count || 0;
        wrong_count = existing.wrong_count || 0;
        consecutive_correct = existing.consecutive_correct || 0;
    } else {
        level = 0;
        correct_count = 0;
        wrong_count = 0;
        consecutive_correct = 0;
    }

    if (isCorrect) {
        correct_count += 1;
        consecutive_correct += 1;
        level = Math.min(5, level + 1);
    } else {
        wrong_count += 1;
        consecutive_correct = 0;
        level = Math.max(0, level - 2);
    }

    const nextDue = nextDueIso(level);
    const last = nowIso();
    const cnSafe = (typeof cn === 'string' && cn) ? cn : (existing ? existing.cn_text : '');
    const inputSafe = (typeof input === 'string') ? input.slice(0, 200) : '';

    if (existing) {
        db.prepare(`UPDATE word_progress
            SET cn_text = ?, correct_count = ?, wrong_count = ?, consecutive_correct = ?,
                level = ?, last_input = ?, next_due_at = ?, last_seen_at = ?
            WHERE user_id = ? AND en_word = ?`).run(
            cnSafe, correct_count, wrong_count, consecutive_correct,
            level, inputSafe, nextDue, last,
            req.user.id, enLow
        );
    } else {
        db.prepare(`INSERT INTO word_progress
            (user_id, en_word, cn_text, correct_count, wrong_count, consecutive_correct,
             level, last_input, next_due_at, last_seen_at, first_seen_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            req.user.id, enLow, cnSafe, correct_count, wrong_count, consecutive_correct,
            level, inputSafe, nextDue, last, last
        );
    }

    res.json({
        en: enLow,
        level,
        correct_count,
        wrong_count,
        consecutive_correct,
        next_due_at: nextDue,
        mastered: level >= 5
    });
});

// GET /api/srs/due?limit=20
// Returns words whose next_due_at <= now, ordered by priority (lower mastery & higher error first)
router.get('/due', (req, res) => {
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
    const rows = db.prepare(`
        SELECT en_word AS en, cn_text AS cn, level, correct_count, wrong_count, next_due_at
        FROM word_progress
        WHERE user_id = ? AND (next_due_at IS NULL OR next_due_at <= ?)
        ORDER BY level ASC, wrong_count DESC, next_due_at ASC
        LIMIT ?
    `).all(req.user.id, nowIso(), limit);
    res.json({ items: rows.map(r => ({ ...r, type: 'word' })) });
});

// GET /api/srs/wrongbook?limit=50
// All words ever answered wrong; priority by net-wrong (wrong - correct) and recency
router.get('/wrongbook', (req, res) => {
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
    const rows = db.prepare(`
        SELECT en_word AS en, cn_text AS cn, level, correct_count, wrong_count, last_input, last_seen_at, next_due_at
        FROM word_progress
        WHERE user_id = ? AND wrong_count > 0 AND level < 5
        ORDER BY (wrong_count - correct_count) DESC, wrong_count DESC, last_seen_at DESC
        LIMIT ?
    `).all(req.user.id, limit);
    res.json({ items: rows.map(r => ({ ...r, type: 'word' })) });
});

// GET /api/srs/stats
router.get('/stats', (req, res) => {
    const total = db.prepare('SELECT COUNT(*) AS c FROM word_progress WHERE user_id = ?').get(req.user.id).c;
    const mastered = db.prepare('SELECT COUNT(*) AS c FROM word_progress WHERE user_id = ? AND level >= 5').get(req.user.id).c;
    const learning = db.prepare('SELECT COUNT(*) AS c FROM word_progress WHERE user_id = ? AND level > 0 AND level < 5').get(req.user.id).c;
    const dueNow = db.prepare(
        'SELECT COUNT(*) AS c FROM word_progress WHERE user_id = ? AND (next_due_at IS NULL OR next_due_at <= ?)'
    ).get(req.user.id, nowIso()).c;
    const wrongbook = db.prepare(
        'SELECT COUNT(*) AS c FROM word_progress WHERE user_id = ? AND wrong_count > 0 AND level < 5'
    ).get(req.user.id).c;
    res.json({ total, mastered, learning, dueNow, wrongbook });
});

// DELETE /api/srs/word/:en — remove a single word from the wrong-book / progress
router.delete('/word/:en', (req, res) => {
    const en = String(req.params.en || '').toLowerCase().trim();
    if (!en) return res.status(400).json({ error: 'en required' });
    const r = db.prepare('DELETE FROM word_progress WHERE user_id = ? AND en_word = ?').run(req.user.id, en);
    res.json({ deleted: r.changes });
});

module.exports = router;
