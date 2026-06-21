/* ============================================
   Storage Module - localStorage management
   本地存储管理模块
   ============================================ */

const Storage = (() => {
    const PREFIX = 'typing_game_';
    const SERVER_FIELDS = [
        'stars', 'coins', 'streak', 'lastPlayDate', 'levelsUnlocked',
        'levelStars', 'levelScores', 'badges',
        'totalCorrect', 'totalAttempts', 'totalWordsTyped',
        'gamesPlayed', 'maxCombo', 'totalTimeMs'
    ];
    let _syncTimer = null;
    let _suppressSync = false;

    // Default data structure
    const defaultData = {
        playerName: '学生',
        stars: 0,
        coins: 0,
        streak: 0,
        lastPlayDate: null,
        levelsUnlocked: 1,   // First level is unlocked
        levelStars: {},      // { "1": 3, "2": 2, ... }
        levelScores: {},     // { "1": 1500, "2": 800, ... }
        badges: [],          // ["spelling_master", ...]
        wrongAnswers: [],    // [{ en, cn, yourAnswer, timestamp }, ...]
        leaderboard: [],     // [{ name, score, date }, ...]
        totalCorrect: 0,
        totalAttempts: 0,
        totalWordsTyped: 0,
        gamesPlayed: 0,
        maxCombo: 0,
        totalTimeMs: 0,
        modulesCompleted: []
    };

    // Get all data
    function getData() {
        const raw = localStorage.getItem(PREFIX + 'data');
        if (!raw) return { ...defaultData };
        try {
            return { ...defaultData, ...JSON.parse(raw) };
        } catch (e) {
            return { ...defaultData };
        }
    }

    // Save all data
    function _writeLocal(data) {
        localStorage.setItem(PREFIX + 'data', JSON.stringify(data));
    }

    function saveData(data) {
        _writeLocal(data);
        if (!_suppressSync) _scheduleSync();
    }

    function _scheduleSync() {
        if (typeof AuthUI === 'undefined' || !AuthUI.isLoggedIn || !AuthUI.isLoggedIn()) return;
        if (_syncTimer) clearTimeout(_syncTimer);
        _syncTimer = setTimeout(syncToServer, 1500);
    }

    // camelCase <-> snake_case mapping for server fields
    const TO_SNAKE = {
        stars: 'stars', coins: 'coins', streak: 'streak',
        lastPlayDate: 'last_play_date', levelsUnlocked: 'levels_unlocked',
        levelStars: 'level_stars', levelScores: 'level_scores', badges: 'badges',
        totalCorrect: 'total_correct', totalAttempts: 'total_attempts',
        totalWordsTyped: 'total_words_typed', gamesPlayed: 'games_played',
        maxCombo: 'max_combo', totalTimeMs: 'total_time_ms'
    };

    async function syncToServer() {
        if (typeof AuthUI === 'undefined' || !AuthUI.isLoggedIn()) return;
        const data = getData();
        const payload = {};
        for (const k of SERVER_FIELDS) {
            const serverKey = TO_SNAKE[k];
            payload[serverKey] = data[k];
        }
        try {
            await AuthUI.apiRequest('/me/stats', {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
        } catch (e) {
            // silent — offline or session expired
        }
    }

    async function syncFromServer() {
        if (typeof AuthUI === 'undefined' || !AuthUI.isLoggedIn()) return;
        try {
            const res = await AuthUI.apiRequest('/me/stats');
            const json = await res.json();
            if (!json || !json.stats) return;
            const s = json.stats;
            const local = getData();
            const merged = { ...local,
                stars: s.stars || 0,
                coins: s.coins || 0,
                streak: s.streak || 0,
                lastPlayDate: s.last_play_date || local.lastPlayDate,
                levelsUnlocked: s.levels_unlocked || 1,
                levelStars: s.level_stars || {},
                levelScores: s.level_scores || {},
                badges: Array.isArray(s.badges) ? s.badges : [],
                totalCorrect: s.total_correct || 0,
                totalAttempts: s.total_attempts || 0,
                totalWordsTyped: s.total_words_typed || 0,
                gamesPlayed: s.games_played || 0,
                maxCombo: s.max_combo || 0,
                totalTimeMs: s.total_time_ms || 0
            };
            _suppressSync = true;
            _writeLocal(merged);
            _suppressSync = false;
        } catch (e) {
            // silent
        }
    }

    async function reportPractice(payload) {
        if (typeof AuthUI === 'undefined' || !AuthUI.isLoggedIn()) return;
        try {
            await AuthUI.apiRequest('/me/practice', {
                method: 'POST',
                body: JSON.stringify(payload || {})
            });
        } catch (e) {
            // silent
        }
    }

    // Update specific field(s)
    function update(updates) {
        const data = getData();
        Object.assign(data, updates);
        saveData(data);
        return data;
    }

    // Check and update daily streak
    function updateStreak() {
        const data = getData();
        const today = new Date().toDateString();

        if (data.lastPlayDate === today) {
            return data; // Already played today
        }

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        if (data.lastPlayDate === yesterday.toDateString()) {
            data.streak += 1; // Continue streak
        } else if (data.lastPlayDate !== today) {
            data.streak = 1; // Reset streak
        }

        data.lastPlayDate = today;
        saveData(data);
        return data;
    }

    // Add coins
    function addCoins(amount) {
        const data = getData();
        data.coins += amount;
        saveData(data);
        return data.coins;
    }

    // Add stars
    function addStars(amount) {
        const data = getData();
        data.stars += amount;
        saveData(data);
        return data.stars;
    }

    // Save level result
    function saveLevelResult(level, score, stars) {
        const data = getData();
        const key = level.toString();

        // Only update if better
        if (!data.levelStars[key] || stars > data.levelStars[key]) {
            data.levelStars[key] = stars;
        }
        if (!data.levelScores[key] || score > data.levelScores[key]) {
            data.levelScores[key] = score;
        }

        // Unlock next level
        if (stars > 0 && level >= data.levelsUnlocked) {
            data.levelsUnlocked = level + 1;
        }

        saveData(data);
        return data;
    }

    // Add wrong answer for review
    function addWrongAnswer(item) {
        const data = getData();
        // Avoid duplicates - keep last 100
        data.wrongAnswers = data.wrongAnswers.filter(w => w.en !== item.en);
        data.wrongAnswers.unshift({
            ...item,
            timestamp: Date.now()
        });
        if (data.wrongAnswers.length > 100) {
            data.wrongAnswers = data.wrongAnswers.slice(0, 100);
        }
        saveData(data);
    }

    // Remove wrong answer (mastered)
    function removeWrongAnswer(en) {
        const data = getData();
        data.wrongAnswers = data.wrongAnswers.filter(w => w.en !== en);
        saveData(data);
    }

    // Badge system
    function earnBadge(badgeId) {
        const data = getData();
        if (!data.badges.includes(badgeId)) {
            data.badges.push(badgeId);
            saveData(data);
            return true; // Newly earned
        }
        return false; // Already have it
    }

    // Leaderboard
    function addLeaderboardEntry(name, score, meta = {}) {
        const data = getData();
        data.leaderboard.push({
            name: name || data.playerName,
            score,
            date: new Date().toLocaleDateString(),
            durationMs: Number(meta.durationMs) || 0,
            accuracy: Number(meta.accuracy) || 0
        });
        // Sort by score descending, then by faster completion time
        data.leaderboard.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            const aDuration = a.durationMs > 0 ? a.durationMs : Number.MAX_SAFE_INTEGER;
            const bDuration = b.durationMs > 0 ? b.durationMs : Number.MAX_SAFE_INTEGER;
            return aDuration - bDuration;
        });
        data.leaderboard = data.leaderboard.slice(0, 20);
        saveData(data);
    }

    // Save player name
    function savePlayerName() {
        const input = document.getElementById('player-name');
        if (input && input.value.trim()) {
            update({ playerName: input.value.trim() });
        }
    }

    // Reset all progress
    function resetAll() {
        if (confirm('确认重置所有进度？此操作不可撤销！\nReset all progress? This cannot be undone!')) {
            localStorage.removeItem(PREFIX + 'data');
            location.reload();
        }
    }

    return {
        getData,
        saveData,
        update,
        updateStreak,
        addCoins,
        addStars,
        saveLevelResult,
        addWrongAnswer,
        removeWrongAnswer,
        earnBadge,
        addLeaderboardEntry,
        savePlayerName,
        resetAll,
        syncFromServer,
        syncToServer,
        reportPractice
    };
})();
