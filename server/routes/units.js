const express = require('express');
const db = require('../db');
const { authenticate, requireAdmin } = require('../auth');

const router = express.Router();

// Get units for current user (own units + public units)
router.get('/', authenticate, (req, res) => {
    const myUnits = db.prepare(`
        SELECT id, name, words, phrases, sentences, is_public, publisher, grade, book, unit_no, created_at, updated_at
        FROM units WHERE user_id = ? ORDER BY updated_at DESC
    `).all(req.user.id);

    const publicUnits = db.prepare(`
        SELECT u.id, u.name, u.words, u.phrases, u.sentences, u.is_public, u.publisher, u.grade, u.book, u.unit_no, u.created_at, u.updated_at, users.username as author
        FROM units u JOIN users ON u.user_id = users.id
        WHERE u.is_public = 1 AND u.user_id != ? ORDER BY u.updated_at DESC
    `).all(req.user.id);

    // Parse JSON fields
    const parseUnit = (unit) => ({
        ...unit,
        words: JSON.parse(unit.words || '[]'),
        phrases: JSON.parse(unit.phrases || '[]'),
        sentences: JSON.parse(unit.sentences || '[]')
    });

    res.json({
        myUnits: myUnits.map(parseUnit),
        publicUnits: publicUnits.map(parseUnit)
    });
});

// Save a new unit
router.post('/', authenticate, (req, res) => {
    const { name, words, phrases, sentences, publisher, grade, book } = req.body;
    let { unit_no } = req.body;

    if (!name) {
        return res.status(400).json({ error: '单元名称不能为空 Unit name required' });
    }

    if (!unit_no || unit_no === 0) {
        const m = String(name).match(/Unit\s*(\d+)/i);
        unit_no = m ? parseInt(m[1], 10) : 0;
    }

    const result = db.prepare(`
        INSERT INTO units (user_id, name, words, phrases, sentences, publisher, grade, book, unit_no)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        req.user.id,
        name,
        JSON.stringify(words || []),
        JSON.stringify(phrases || []),
        JSON.stringify(sentences || []),
        publisher || '',
        grade || '',
        book || '',
        parseInt(unit_no, 10) || 0
    );

    res.json({ id: result.lastInsertRowid, message: '保存成功 Saved successfully' });
});

// Update a unit
router.put('/:id', authenticate, (req, res) => {
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id);

    if (!unit) {
        return res.status(404).json({ error: '单元不存在 Unit not found' });
    }

    // Only owner or admin can edit
    if (unit.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: '无权修改 No permission to edit' });
    }

    const { name, words, phrases, sentences, publisher, grade, book } = req.body;
    let { unit_no } = req.body;

    const finalName = name || unit.name;
    if (unit_no === undefined || unit_no === null) {
        const m = String(finalName).match(/Unit\s*(\d+)/i);
        unit_no = m ? parseInt(m[1], 10) : (unit.unit_no || 0);
    }

    db.prepare(`
        UPDATE units SET name = ?, words = ?, phrases = ?, sentences = ?,
            publisher = ?, grade = ?, book = ?, unit_no = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(
        finalName,
        JSON.stringify(words || JSON.parse(unit.words)),
        JSON.stringify(phrases || JSON.parse(unit.phrases)),
        JSON.stringify(sentences || JSON.parse(unit.sentences)),
        publisher !== undefined ? publisher : (unit.publisher || ''),
        grade !== undefined ? grade : (unit.grade || ''),
        book !== undefined ? book : (unit.book || ''),
        parseInt(unit_no, 10) || 0,
        req.params.id
    );

    res.json({ message: '更新成功 Updated successfully' });
});

// Delete a unit
router.delete('/:id', authenticate, (req, res) => {
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id);

    if (!unit) {
        return res.status(404).json({ error: '单元不存在 Unit not found' });
    }

    // Only owner or admin can delete
    if (unit.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: '无权删除 No permission to delete' });
    }

    db.prepare('DELETE FROM units WHERE id = ?').run(req.params.id);
    res.json({ message: '删除成功 Deleted successfully' });
});

// ========== ADMIN ROUTES ==========

// Get all units (admin only)
router.get('/admin/all', authenticate, requireAdmin, (req, res) => {
    const units = db.prepare(`
        SELECT u.id, u.name, u.words, u.phrases, u.sentences, u.is_public,
               u.publisher, u.grade, u.book, u.unit_no,
               u.created_at, u.updated_at,
               users.username as author, u.user_id
        FROM units u JOIN users ON u.user_id = users.id
        ORDER BY u.updated_at DESC
    `).all();

    const parseUnit = (unit) => ({
        ...unit,
        words: JSON.parse(unit.words || '[]'),
        phrases: JSON.parse(unit.phrases || '[]'),
        sentences: JSON.parse(unit.sentences || '[]')
    });

    res.json({ units: units.map(parseUnit) });
});

// Publish unit to public library (admin only)
router.post('/admin/publish/:id', authenticate, requireAdmin, (req, res) => {
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id);

    if (!unit) {
        return res.status(404).json({ error: '单元不存在 Unit not found' });
    }

    // Copy to public library (create a new unit owned by admin, marked as public)
    const result = db.prepare(`
        INSERT INTO units (user_id, name, words, phrases, sentences, is_public)
        VALUES (?, ?, ?, ?, ?, 1)
    `).run(req.user.id, unit.name, unit.words, unit.phrases, unit.sentences);

    res.json({ id: result.lastInsertRowid, message: '已发布到公共库 Published to public library' });
});

// Toggle public status (admin only)
router.post('/admin/toggle-public/:id', authenticate, requireAdmin, (req, res) => {
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id);

    if (!unit) {
        return res.status(404).json({ error: '单元不存在 Unit not found' });
    }

    const newStatus = unit.is_public ? 0 : 1;
    db.prepare('UPDATE units SET is_public = ? WHERE id = ?').run(newStatus, req.params.id);

    res.json({ is_public: newStatus, message: newStatus ? '已设为公开 Set as public' : '已设为私有 Set as private' });
});

module.exports = router;
