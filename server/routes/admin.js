const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticate, requireAdmin } = require('../auth');

const router = express.Router();

router.use(authenticate);
router.use(requireAdmin);

// GET /api/admin/users
router.get('/users', (req, res) => {
    const rows = db.prepare(`
        SELECT u.id, u.username, u.role, u.created_at,
               s.stars, s.coins, s.streak, s.total_time_ms, s.games_played,
               s.total_correct, s.total_attempts,
               (SELECT COUNT(*) FROM login_days WHERE user_id = u.id) AS login_days
        FROM users u
        LEFT JOIN user_stats s ON s.user_id = u.id
        ORDER BY u.created_at DESC
    `).all();
    res.json({ users: rows });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: '无效的用户ID Invalid user id' });
    if (req.user.id === id) {
        return res.status(400).json({ error: '不能删除自己 Cannot delete yourself' });
    }
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: '用户不存在 User not found' });

    const tx = db.transaction((uid) => {
        db.prepare('DELETE FROM units WHERE user_id = ?').run(uid);
        db.prepare('DELETE FROM practice_logs WHERE user_id = ?').run(uid);
        db.prepare('DELETE FROM login_days WHERE user_id = ?').run(uid);
        db.prepare('DELETE FROM user_stats WHERE user_id = ?').run(uid);
        db.prepare('DELETE FROM users WHERE id = ?').run(uid);
    });
    tx(id);
    res.json({ success: true, message: '用户已删除 User deleted' });
});

// POST /api/admin/users/:id/reset-password
router.post('/users/:id/reset-password', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { newPassword } = req.body || {};
    if (!id) return res.status(400).json({ error: '无效的用户ID Invalid user id' });
    if (!newPassword || newPassword.length < 4) {
        return res.status(400).json({ error: '密码至少4个字符 Password must be at least 4 characters' });
    }
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: '用户不存在 User not found' });
    const hashed = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, id);
    res.json({ success: true, message: '密码已重置 Password reset' });
});

// GET /api/admin/users/:id/practice-history
router.get('/users/:id/practice-history', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: '无效的用户ID Invalid user id' });
    let limit = parseInt(req.query.limit, 10) || 200;
    if (limit < 1) limit = 1;
    if (limit > 1000) limit = 1000;
    const rows = db.prepare(
        'SELECT id, kind, ref_id, score, stars, correct, attempts, duration_ms, created_at FROM practice_logs WHERE user_id = ? ORDER BY id DESC LIMIT ?'
    ).all(id, limit);
    res.json({ history: rows });
});

// GET /api/admin/rankings?type=score|time|streak|login_days&limit=50
router.get('/rankings', (req, res) => {
    const type = req.query.type || 'score';
    let limit = parseInt(req.query.limit, 10) || 50;
    if (limit < 1) limit = 1;
    if (limit > 200) limit = 200;

    let sql, valueKey;
    if (type === 'score') {
        valueKey = 'value';
        sql = `SELECT u.id, u.username, COALESCE(SUM(p.score), 0) AS value
               FROM users u LEFT JOIN practice_logs p ON p.user_id = u.id
               GROUP BY u.id, u.username
               ORDER BY value DESC LIMIT ?`;
    } else if (type === 'time') {
        valueKey = 'value';
        sql = `SELECT u.id, u.username, COALESCE(SUM(p.duration_ms), 0) AS value
               FROM users u LEFT JOIN practice_logs p ON p.user_id = u.id
               GROUP BY u.id, u.username
               ORDER BY value DESC LIMIT ?`;
    } else if (type === 'streak') {
        valueKey = 'value';
        sql = `SELECT u.id, u.username, COALESCE(s.streak, 0) AS value
               FROM users u LEFT JOIN user_stats s ON s.user_id = u.id
               ORDER BY value DESC LIMIT ?`;
    } else if (type === 'login_days') {
        valueKey = 'value';
        sql = `SELECT u.id, u.username,
                  (SELECT COUNT(*) FROM login_days WHERE user_id = u.id) AS value
               FROM users u
               ORDER BY value DESC LIMIT ?`;
    } else {
        return res.status(400).json({ error: '无效的排行类型 Invalid ranking type' });
    }

    const rows = db.prepare(sql).all(limit);
    const ranked = rows.map((r, i) => ({
        rank: i + 1,
        id: r.id,
        username: r.username,
        value: r.value
    }));
    res.json({ type, rankings: ranked });
});

module.exports = router;
