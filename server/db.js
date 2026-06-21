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

    CREATE TABLE IF NOT EXISTS word_progress (
        user_id INTEGER NOT NULL,
        en_word TEXT NOT NULL,
        cn_text TEXT DEFAULT '',
        correct_count INTEGER DEFAULT 0,
        wrong_count INTEGER DEFAULT 0,
        consecutive_correct INTEGER DEFAULT 0,
        level INTEGER DEFAULT 0,
        last_input TEXT DEFAULT '',
        next_due_at DATETIME,
        last_seen_at DATETIME,
        first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, en_word)
    );
    CREATE INDEX IF NOT EXISTS idx_word_progress_due ON word_progress(user_id, next_due_at);
    CREATE INDEX IF NOT EXISTS idx_word_progress_wrong ON word_progress(user_id, wrong_count);

    CREATE TABLE IF NOT EXISTS example_cache (
        word TEXT PRIMARY KEY,
        examples_json TEXT NOT NULL,
        fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS vocab_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        en_text TEXT NOT NULL,
        cn_text TEXT DEFAULT '',
        user_answer TEXT DEFAULT '',
        item_type TEXT DEFAULT 'word',
        prompt_mode TEXT DEFAULT '',
        source_kind TEXT DEFAULT '',
        source_unit_id INTEGER,
        source_unit_name TEXT DEFAULT '',
        source_ref TEXT DEFAULT '',
        note TEXT DEFAULT '',
        status TEXT DEFAULT 'open',
        admin_note TEXT DEFAULT '',
        resolved_unit_id INTEGER,
        resolved_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_vocab_reports_status ON vocab_reports(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_vocab_reports_en_text ON vocab_reports(en_text);
    CREATE INDEX IF NOT EXISTS idx_vocab_reports_unit ON vocab_reports(source_unit_id);
`);

// ---- Migrations: add metadata columns to units (idempotent) ----
function ensureColumn(table, col, type) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some(c => c.name === col)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    }
}
ensureColumn('units', 'publisher', "TEXT DEFAULT ''");
ensureColumn('units', 'grade',     "TEXT DEFAULT ''");
ensureColumn('units', 'book',      "TEXT DEFAULT ''");
ensureColumn('units', 'unit_no',   "INTEGER DEFAULT 0");
ensureColumn('units', 'display_order', "INTEGER DEFAULT 0");
ensureColumn('units', 'source_file_name', "TEXT DEFAULT ''");
ensureColumn('units', 'source_mime_type', "TEXT DEFAULT ''");
ensureColumn('units', 'source_file_path', "TEXT DEFAULT ''");
ensureColumn('units', 'source_text',      "TEXT DEFAULT ''");
ensureColumn('users', 'grade',     "TEXT DEFAULT ''");
ensureColumn('practice_logs', 'session_title',   "TEXT DEFAULT ''");
ensureColumn('practice_logs', 'wrong_items_json',"TEXT DEFAULT '[]'");

// Backfill unit_no by extracting "Unit N" from name, where empty/zero
try {
    const rows = db.prepare("SELECT id, name FROM units WHERE unit_no IS NULL OR unit_no = 0").all();
    const upd = db.prepare("UPDATE units SET unit_no = ? WHERE id = ?");
    for (const r of rows) {
        const m = (r.name || '').match(/Unit\s*(\d+)/i);
        if (m) upd.run(parseInt(m[1], 10), r.id);
    }
} catch (e) {
    console.warn('[db] unit_no backfill failed:', e.message);
}

try {
    const rows = db.prepare("SELECT id, unit_no FROM units WHERE display_order IS NULL OR display_order = 0").all();
    const upd = db.prepare("UPDATE units SET display_order = ? WHERE id = ?");
    let nextOrder = 10000;
    for (const r of rows) {
        const order = (parseInt(r.unit_no, 10) || 0) > 0 ? parseInt(r.unit_no, 10) : nextOrder++;
        upd.run(order, r.id);
    }
} catch (e) {
    console.warn('[db] display_order backfill failed:', e.message);
}

// Create default admin account if not exists
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    const result = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('admin', hashedPassword, 'admin');
    db.prepare('INSERT OR IGNORE INTO user_stats (user_id) VALUES (?)').run(result.lastInsertRowid);
    console.log('Default admin account created (username: admin, password: admin123)');
}

module.exports = db;
