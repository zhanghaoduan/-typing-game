const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticate, requireAdmin } = require('../auth');
const dictApi = require('./dict');
const translateApi = require('./translate');

const router = express.Router();

function parseUnitRow(unit) {
    return {
        ...unit,
        words: JSON.parse(unit.words || '[]'),
        phrases: JSON.parse(unit.phrases || '[]'),
        sentences: JSON.parse(unit.sentences || '[]')
    };
}

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/^[a-z]+\.\s*/ig, '')
        .replace(/[()（）【】[\]{}]/g, ' ')
        .replace(/[，,；;、/|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function splitMeaningTerms(value) {
    return normalizeText(value)
        .split(/\s+/)
        .map(s => s.trim())
        .filter(Boolean)
        .flatMap(s => s.split(/[-—]/).map(x => x.trim()).filter(Boolean))
        .filter(s => s.length >= 1);
}

function meaningsOverlap(current, candidate) {
    const currentNorm = normalizeText(current).replace(/\s+/g, '');
    const candidateNorm = normalizeText(candidate).replace(/\s+/g, '');
    if (!currentNorm || !candidateNorm) return false;
    if (currentNorm === candidateNorm) return true;
    if (currentNorm.includes(candidateNorm) || candidateNorm.includes(currentNorm)) return true;
    const currentTerms = splitMeaningTerms(current);
    const candidateTerms = splitMeaningTerms(candidate);
    return currentTerms.some(a => candidateTerms.some(b => a === b || a.includes(b) || b.includes(a)));
}

async function auditItem(entry) {
    let dictResult = null;
    let textbookTranslation = '';
    try {
        dictResult = await dictApi.lookupWord(entry.en);
    } catch (_) {}
    try {
        textbookTranslation = await translateApi.translateOne(entry.en);
    } catch (_) {}
    const dictMeanings = Array.isArray(dictResult && dictResult.meanings) ? dictResult.meanings : [];
    const referenceList = [
        ...dictMeanings.map(m => m && m.def_cn).filter(Boolean),
        textbookTranslation
    ].filter(Boolean);
    const hasReference = referenceList.length > 0;
    const matchesReference = hasReference ? referenceList.some(ref => meaningsOverlap(entry.cn, ref)) : false;
    const suspicious = !entry.cn || (hasReference && !matchesReference);
    const reasons = [];
    if (!entry.cn) reasons.push('当前中文释义为空');
    if (hasReference && !matchesReference) reasons.push('当前释义与词典/翻译结果差异较大');
    return {
        ...entry,
        suspicious,
        reasons,
        references: {
            dictionary: dictMeanings.slice(0, 3).map(m => ({
                pos: m.pos || '',
                def_cn: m.def_cn || '',
                def_en: m.def_en || ''
            })),
            textbookTranslation: textbookTranslation || ''
        }
    };
}

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
        db.prepare('DELETE FROM vocab_reports WHERE user_id = ?').run(uid);
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

// GET /api/admin/vocab-reports
router.get('/vocab-reports', (req, res) => {
    const status = String(req.query.status || 'open').trim();
    const sql = `
        SELECT r.*, u.username
        FROM vocab_reports r
        JOIN users u ON u.id = r.user_id
        ${status === 'all' ? '' : 'WHERE r.status = ?'}
        ORDER BY CASE WHEN r.status = 'open' THEN 0 ELSE 1 END, r.created_at DESC
        LIMIT 300
    `;
    const reports = status === 'all'
        ? db.prepare(sql).all()
        : db.prepare(sql).all(status);
    res.json({ reports });
});

// POST /api/admin/vocab-reports/:id/resolve
router.post('/vocab-reports/:id/resolve', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: '无效的记录ID Invalid report id' });
    const report = db.prepare('SELECT * FROM vocab_reports WHERE id = ?').get(id);
    if (!report) return res.status(404).json({ error: '记录不存在 Report not found' });
    const status = String((req.body && req.body.status) || 'resolved').trim();
    if (!['open', 'resolved', 'ignored'].includes(status)) {
        return res.status(400).json({ error: '无效状态 Invalid status' });
    }
    db.prepare(`
        UPDATE vocab_reports
        SET status = ?, admin_note = ?, resolved_unit_id = ?, resolved_at = CASE WHEN ? = 'open' THEN NULL ELSE CURRENT_TIMESTAMP END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(
        status,
        String((req.body && req.body.admin_note) || '').trim(),
        req.body && req.body.resolved_unit_id ? Number(req.body.resolved_unit_id) : null,
        status,
        id
    );
    res.json({ success: true, message: '处理成功 Review updated' });
});

// GET /api/admin/vocab-audit
router.get('/vocab-audit', async (req, res) => {
    const scope = String(req.query.scope || 'public').trim();
    let limit = parseInt(req.query.limit, 10) || 60;
    if (limit < 1) limit = 1;
    if (limit > 200) limit = 200;
    const suspiciousOnly = String(req.query.suspiciousOnly || '1') !== '0';
    const rows = db.prepare(`
        SELECT u.id, u.name, u.words, u.phrases, u.sentences, u.is_public, u.publisher, u.grade, u.book, u.unit_no,
               u.created_at, u.updated_at, users.username AS author
        FROM units u
        JOIN users ON users.id = u.user_id
        ${scope === 'all' ? '' : 'WHERE u.is_public = 1'}
        ORDER BY u.updated_at DESC
    `).all();
    const units = rows.map(parseUnitRow);
    const entries = [];
    units.forEach(unit => {
        (unit.words || []).forEach((item, index) => entries.push({ unitId: unit.id, unitName: unit.name, author: unit.author, isPublic: !!unit.is_public, field: 'words', index, itemType: 'word', en: item.en, cn: item.cn || '' }));
        (unit.phrases || []).forEach((item, index) => entries.push({ unitId: unit.id, unitName: unit.name, author: unit.author, isPublic: !!unit.is_public, field: 'phrases', index, itemType: 'phrase', en: item.en, cn: item.cn || '' }));
        (unit.sentences || []).forEach((item, index) => entries.push({ unitId: unit.id, unitName: unit.name, author: unit.author, isPublic: !!unit.is_public, field: 'sentences', index, itemType: 'sentence', en: item.en, cn: item.cn || '' }));
    });
    const limitedEntries = entries.filter(item => String(item.en || '').trim()).slice(0, limit);
    const results = [];
    for (const entry of limitedEntries) {
        results.push(await auditItem(entry));
    }
    res.json({
        scope,
        suspiciousOnly,
        items: suspiciousOnly ? results.filter(item => item.suspicious) : results
    });
});

module.exports = router;
