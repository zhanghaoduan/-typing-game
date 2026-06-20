const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'typing-game-secret-key-2024';

// Middleware to verify JWT token
function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: '未登录 Please login first' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: '登录已过期 Token expired, please login again' });
    }
}

// Middleware to check admin role.
// The database is the source of truth for the role so that legacy tokens
// (issued before the role claim existed) or recently-promoted admins are not
// wrongly rejected. Falls back to the token claim if the lookup fails.
function requireAdmin(req, res, next) {
    let role = req.user && req.user.role;
    try {
        if (req.user && req.user.id != null) {
            const row = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id);
            if (row && row.role) {
                role = row.role;
                req.user.role = role; // keep request state in sync
            }
        }
    } catch (_) {
        // Ignore DB errors and fall back to the token claim.
    }
    if (role !== 'admin') {
        return res.status(403).json({ error: '需要管理员权限 Admin access required' });
    }
    next();
}

function generateToken(user) {
    return jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
}

module.exports = { authenticate, requireAdmin, generateToken, JWT_SECRET };
