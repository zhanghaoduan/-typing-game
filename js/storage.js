/* ============================================
   Storage Module - localStorage management
   本地存储管理模块
   ============================================ */

const Storage = (() => {
    const PREFIX = 'typing_game_';

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
    function saveData(data) {
        localStorage.setItem(PREFIX + 'data', JSON.stringify(data));
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
    function addLeaderboardEntry(name, score) {
        const data = getData();
        data.leaderboard.push({
            name: name || data.playerName,
            score,
            date: new Date().toLocaleDateString()
        });
        // Sort by score descending, keep top 20
        data.leaderboard.sort((a, b) => b.score - a.score);
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
        resetAll
    };
})();
