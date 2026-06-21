const express = require('express');
const db = require('../db');
const { authenticate, requireAdmin } = require('../auth');

const router = express.Router();

// Get units for current user (own units + public units)
router.get('/', authenticate, (req, res) => {
    const myUnits = db.prepare(`
        SELECT id, name, words, phrases, sentences, is_public, publisher, grade, book, unit_no, display_order,
               source_file_name, source_mime_type, source_file_path, source_refs_json, pending_public,
               created_at, updated_at
        FROM units
        WHERE user_id = ?
        ORDER BY display_order ASC, CASE WHEN unit_no > 0 THEN unit_no ELSE 999999 END ASC, name COLLATE NOCASE ASC, id ASC
    `).all(req.user.id);

    const publicUnits = db.prepare(`
        SELECT u.id, u.name, u.words, u.phrases, u.sentences, u.is_public, u.publisher, u.grade, u.book, u.unit_no, u.display_order,
               u.source_file_name, u.source_mime_type, u.source_file_path, u.source_refs_json, u.pending_public,
               u.created_at, u.updated_at, users.username as author
        FROM units u JOIN users ON u.user_id = users.id
        WHERE u.is_public = 1 AND u.user_id != ?
        ORDER BY u.display_order ASC, CASE WHEN u.unit_no > 0 THEN u.unit_no ELSE 999999 END ASC, u.name COLLATE NOCASE ASC, u.id ASC
    `).all(req.user.id);

    // Parse JSON fields
    const parseUnit = (unit) => ({
        ...unit,
        words: JSON.parse(unit.words || '[]'),
        phrases: JSON.parse(unit.phrases || '[]'),
        sentences: JSON.parse(unit.sentences || '[]'),
        source_refs_json: JSON.parse(unit.source_refs_json || '[]')
    });

    res.json({
        myUnits: myUnits.map(parseUnit),
        publicUnits: publicUnits.map(parseUnit)
    });
});

// Save a new unit
router.post('/', authenticate, (req, res) => {
    const { name, words, phrases, sentences, publisher, grade, book, source_file_name, source_mime_type, source_file_path, source_text, source_refs_json } = req.body;
    let { unit_no } = req.body;
    let { display_order } = req.body;

    if (!name) {
        return res.status(400).json({ error: '单元名称不能为空 Unit name required' });
    }

    if (!unit_no || unit_no === 0) {
        const m = String(name).match(/Unit\s*(\d+)/i);
        unit_no = m ? parseInt(m[1], 10) : 0;
    }

    if (display_order === undefined || display_order === null || display_order === '') {
        const parsedUnitNo = parseInt(unit_no, 10) || 0;
        if (parsedUnitNo > 0) {
            display_order = parsedUnitNo;
        } else {
            const row = db.prepare('SELECT COALESCE(MAX(display_order), 0) AS max_order FROM units WHERE user_id = ?').get(req.user.id);
            display_order = (row && row.max_order ? Number(row.max_order) : 0) + 1;
        }
    }

    const result = db.prepare(`
        INSERT INTO units (user_id, name, words, phrases, sentences, publisher, grade, book, unit_no,
                           display_order, source_file_name, source_mime_type, source_file_path, source_text, source_refs_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        req.user.id,
        name,
        JSON.stringify(words || []),
        JSON.stringify(phrases || []),
        JSON.stringify(sentences || []),
        publisher || '',
        grade || '',
        book || '',
        parseInt(unit_no, 10) || 0,
        parseInt(display_order, 10) || 0,
        source_file_name || '',
        source_mime_type || '',
        source_file_path || '',
        source_text || '',
        JSON.stringify(source_refs_json || [])
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

    const { name, words, phrases, sentences, publisher, grade, book, source_file_name, source_mime_type, source_file_path, source_text, source_refs_json } = req.body;
    let { unit_no } = req.body;
    let { display_order } = req.body;

    const finalName = name || unit.name;
    if (unit_no === undefined || unit_no === null) {
        const m = String(finalName).match(/Unit\s*(\d+)/i);
        unit_no = m ? parseInt(m[1], 10) : (unit.unit_no || 0);
    }

    if (display_order === undefined || display_order === null || display_order === '') {
        display_order = unit.display_order || 0;
    }

    db.prepare(`
        UPDATE units SET name = ?, words = ?, phrases = ?, sentences = ?,
            publisher = ?, grade = ?, book = ?, unit_no = ?, display_order = ?,
            source_file_name = ?, source_mime_type = ?, source_file_path = ?, source_text = ?, source_refs_json = ?,
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
        parseInt(display_order, 10) || 0,
        source_file_name !== undefined ? source_file_name : (unit.source_file_name || ''),
        source_mime_type !== undefined ? source_mime_type : (unit.source_mime_type || ''),
        source_file_path !== undefined ? source_file_path : (unit.source_file_path || ''),
        source_text !== undefined ? source_text : (unit.source_text || ''),
        source_refs_json !== undefined ? JSON.stringify(source_refs_json || []) : (unit.source_refs_json || '[]'),
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
               u.publisher, u.grade, u.book, u.unit_no, u.display_order,
               u.source_file_name, u.source_mime_type, u.source_file_path, u.source_refs_json, u.pending_public,
               u.created_at, u.updated_at,
               users.username as author, u.user_id
        FROM units u JOIN users ON u.user_id = users.id
        ORDER BY u.pending_public DESC, u.display_order ASC, CASE WHEN u.unit_no > 0 THEN u.unit_no ELSE 999999 END ASC, u.name COLLATE NOCASE ASC, u.id ASC
    `).all();

    const parseUnit = (unit) => ({
        ...unit,
        words: JSON.parse(unit.words || '[]'),
        phrases: JSON.parse(unit.phrases || '[]'),
        sentences: JSON.parse(unit.sentences || '[]'),
        source_refs_json: JSON.parse(unit.source_refs_json || '[]')
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
        INSERT INTO units (user_id, name, words, phrases, sentences, is_public,
                           publisher, grade, book, unit_no, display_order, source_file_name, source_mime_type, source_file_path, source_text, source_refs_json)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        req.user.id,
        unit.name,
        unit.words,
        unit.phrases,
        unit.sentences,
        unit.publisher || '',
        unit.grade || '',
        unit.book || '',
        unit.unit_no || 0,
        unit.display_order || unit.unit_no || 0,
        unit.source_file_name || '',
        unit.source_mime_type || '',
        unit.source_file_path || '',
        unit.source_text || '',
        unit.source_refs_json || '[]'
    );

    res.json({ id: result.lastInsertRowid, message: '已发布到公共库 Published to public library' });
});

router.post('/:id/submit-public', authenticate, (req, res) => {
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id);
    if (!unit) {
        return res.status(404).json({ error: '单元不存在 Unit not found' });
    }
    if (unit.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: '无权提交 No permission to submit' });
    }
    if (unit.is_public) {
        return res.json({ pending_public: 0, message: '该单元已公开 This unit is already public' });
    }
    if (unit.pending_public) {
        return res.json({ pending_public: 1, message: '已提交管理员审核 Already submitted for admin review' });
    }

    const sourceRefs = Array.isArray(req.body && req.body.source_refs_json)
        ? req.body.source_refs_json
        : null;

    db.prepare(`
        UPDATE units
        SET pending_public = 1,
            source_refs_json = CASE
                WHEN ? IS NOT NULL AND length(?) > 2 THEN ?
                ELSE source_refs_json
            END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(
        sourceRefs ? JSON.stringify(sourceRefs) : null,
        sourceRefs ? JSON.stringify(sourceRefs) : null,
        sourceRefs ? JSON.stringify(sourceRefs) : null,
        req.params.id
    );

    res.json({ pending_public: 1, message: '已提交管理员公开审核 Submitted for admin public review' });
});

router.post('/admin/approve-public/:id', authenticate, requireAdmin, (req, res) => {
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id);
    if (!unit) {
        return res.status(404).json({ error: '单元不存在 Unit not found' });
    }

    db.prepare(`
        UPDATE units
        SET is_public = 1, pending_public = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(req.params.id);

    res.json({ is_public: 1, pending_public: 0, message: '已审核并公开 Approved and published' });
});

router.post('/admin/reject-public/:id', authenticate, requireAdmin, (req, res) => {
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id);
    if (!unit) {
        return res.status(404).json({ error: '单元不存在 Unit not found' });
    }

    db.prepare(`
        UPDATE units
        SET pending_public = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(req.params.id);

    res.json({ pending_public: 0, message: '已退回为私有单元 Returned to private unit' });
});

// Toggle public status (admin only)
router.post('/admin/toggle-public/:id', authenticate, requireAdmin, (req, res) => {
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id);

    if (!unit) {
        return res.status(404).json({ error: '单元不存在 Unit not found' });
    }

    const newStatus = unit.is_public ? 0 : 1;
    db.prepare('UPDATE units SET is_public = ?, pending_public = ? WHERE id = ?').run(newStatus, 0, req.params.id);

    res.json({ is_public: newStatus, message: newStatus ? '已设为公开 Set as public' : '已设为私有 Set as private' });
});

router.post('/admin/reorder/:id', authenticate, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const direction = String((req.body && req.body.direction) || '').trim();
    if (!id) return res.status(400).json({ error: '单元ID无效 Invalid unit id' });
    if (!['up', 'down'].includes(direction)) {
        return res.status(400).json({ error: '排序方向无效 Invalid direction' });
    }
    const target = db.prepare('SELECT id, user_id, display_order, unit_no, name FROM units WHERE id = ?').get(id);
    if (!target) return res.status(404).json({ error: '单元不存在 Unit not found' });

    const units = db.prepare(`
        SELECT id, display_order, unit_no, name
        FROM units
        WHERE user_id = ?
        ORDER BY display_order ASC, CASE WHEN unit_no > 0 THEN unit_no ELSE 999999 END ASC, name COLLATE NOCASE ASC, id ASC
    `).all(target.user_id);

    const index = units.findIndex(unit => unit.id === id);
    if (index === -1) return res.status(404).json({ error: '单元不存在 Unit not found' });
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= units.length) {
        return res.json({ success: true, message: '已经在边界 No more movement' });
    }

    const current = units[index];
    const other = units[swapIndex];
    const currentOrder = parseInt(current.display_order, 10) || 0;
    const otherOrder = parseInt(other.display_order, 10) || 0;
    const tx = db.transaction(() => {
        db.prepare('UPDATE units SET display_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(otherOrder, current.id);
        db.prepare('UPDATE units SET display_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(currentOrder, other.id);
    });
    tx();
    res.json({ success: true, message: '排序已更新 Order updated' });
});

module.exports = router;
