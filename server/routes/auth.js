const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { generateToken } = require('../auth');

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
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

module.exports = router;
