const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve static files from parent directory
app.use(express.static(path.join(__dirname, '..')));

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/units', require('./routes/units'));
app.use('/api/me', require('./routes/me'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/translate', require('./routes/translate'));
app.use('/api/practice', require('./routes/practice'));
app.use('/api/srs', require('./routes/srs'));
app.use('/api/dict', require('./routes/dict'));

// Fallback to index.html for SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// Initialize database
require('./db');

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log(`Default admin: username=admin, password=admin123`);
});
