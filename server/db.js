const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'data', 'typing_game.db');

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS units (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        is_public INTEGER DEFAULT 0,
        words TEXT DEFAULT '[]',
        phrases TEXT DEFAULT '[]',
        sentences TEXT DEFAULT '[]',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_units_user_id ON units(user_id);
    CREATE INDEX IF NOT EXISTS idx_units_is_public ON units(is_public);

    CREATE TABLE IF NOT EXISTS user_stats (
        user_id INTEGER PRIMARY KEY,
        stars INTEGER DEFAULT 0,
        coins INTEGER DEFAULT 0,
        streak INTEGER DEFAULT 0,
        last_play_date TEXT,
        levels_unlocked INTEGER DEFAULT 1,
        level_stars TEXT DEFAULT '{}',
        level_scores TEXT DEFAULT '{}',
        badges TEXT DEFAULT '[]',
        total_correct INTEGER DEFAULT 0,
        total_attempts INTEGER DEFAULT 0,
        total_words_typed INTEGER DEFAULT 0,
        games_played INTEGER DEFAULT 0,
        max_combo INTEGER DEFAULT 0,
        total_time_ms INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS login_days (
        user_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        PRIMARY KEY (user_id, date)
    );
    CREATE INDEX IF NOT EXISTS idx_login_days_user_id ON login_days(user_id);

    CREATE TABLE IF NOT EXISTS practice_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        kind TEXT,
        ref_id TEXT,
        score INTEGER DEFAULT 0,
        stars INTEGER DEFAULT 0,
        correct INTEGER DEFAULT 0,
        attempts INTEGER DEFAULT 0,
        duration_ms INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_practice_logs_user_id ON practice_logs(user_id);

    CREATE TABLE IF NOT EXISTS translation_cache (
        en_text TEXT PRIMARY KEY,
        zh_text TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// Create default admin account if not exists
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    const result = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('admin', hashedPassword, 'admin');
    db.prepare('INSERT OR IGNORE INTO user_stats (user_id) VALUES (?)').run(result.lastInsertRowid);
    console.log('Default admin account created (username: admin, password: admin123)');
}

module.exports = db;
