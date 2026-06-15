const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { generateToken, authenticate } = require('../auth');

const router = express.Router();

// Register
router.post('/register', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: '用户名和密码不能为空 Username and password required' });
    }

    if (username.length < 2 || username.length > 20) {
        return res.status(400).json({ error: '用户名需要2-20个字符 Username must be 2-20 characters' });
    }

    if (password.length < 4) {
        return res.status(400).json({ error: '密码至少4个字符 Password must be at least 4 characters' });
    }

    // Check if username exists
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
        return res.status(400).json({ error: '用户名已存在 Username already exists' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hashedPassword);

    const user = { id: result.lastInsertRowid, username, role: 'user' };
    db.prepare('INSERT OR IGNORE INTO user_stats (user_id) VALUES (?)').run(user.id);
    const token = generateToken(user);

    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// Login
router.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: '用户名和密码不能为空 Username and password required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
        return res.status(401).json({ error: '用户名或密码错误 Invalid username or password' });
    }

    if (!bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: '用户名或密码错误 Invalid username or password' });
    }

    const token = generateToken(user);
    db.prepare('INSERT OR IGNORE INTO user_stats (user_id) VALUES (?)').run(user.id);
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// Change password (authenticated)
router.post('/change-password', authenticate, (req, res) => {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) {
        return res.status(400).json({ error: '请输入旧密码和新密码 Old and new password required' });
    }
    if (newPassword.length < 4) {
        return res.status(400).json({ error: '新密码至少4个字符 New password must be at least 4 characters' });
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
        return res.status(401).json({ error: '用户不存在 User not found' });
    }
    if (!bcrypt.compareSync(oldPassword, user.password)) {
        return res.status(401).json({ error: '旧密码错误 Old password incorrect' });
    }
    const hashed = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, user.id);
    res.json({ success: true, message: '密码已修改 Password updated' });
});

module.exports = router;
