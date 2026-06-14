const jwt = require('jsonwebtoken');

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

// Middleware to check admin role
function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
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
