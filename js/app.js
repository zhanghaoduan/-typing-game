/* ============================================
   App Module - Navigation, initialization, UI
   应用主模块 - 导航、初始化、界面
   ============================================ */

const App = (() => {
    // All badge definitions for display
    const ALL_BADGES = [
        { id: 'first_steps', name: '初次闯关 First Steps', icon: '👶', desc: '完成第一关 Complete Level 1' },
        { id: 'spelling_master', name: '拼写大师 Spelling Master', icon: '📝', desc: '正确拼写50个单词 Type 50 words correctly' },
        { id: 'speed_star', name: '速度之星 Speed Star', icon: '⚡', desc: '达到10连击 Reach 10x combo' },
        { id: 'listening_hero', name: '听力英雄 Listening Hero', icon: '🎧', desc: '通过听力关卡 Pass a listening level' },
        { id: 'perfectionist', name: '完美主义者 Perfectionist', icon: '💎', desc: '一局100%正确率 100% accuracy in one game' },
        { id: 'streak_master', name: '坚持大师 Streak Master', icon: '🔥', desc: '连续7天游戏 Play 7 days in a row' },
        { id: 'coin_collector', name: '金币收藏家 Coin Collector', icon: '🪙', desc: '获得100金币 Earn 100 coins' },
        { id: 'star_collector', name: '星星收集者 Star Collector', icon: '🌟', desc: '获得30颗星 Earn 30 stars' },
        { id: 'module_champion', name: '模块冠军 Module Champion', icon: '🏆', desc: '完成10局游戏 Play 10 games' },
        { id: 'champion', name: '全关卡冠军 Champion', icon: '👑', desc: '通过所有关卡 Pass all levels' }
    ];

    // Initialize app
    async function init() {
        Audio.init();
        if (typeof ImageOCR !== 'undefined') ImageOCR.init();
        Storage.updateStreak();
        updateHomeStats();
        await Game.loadModuleData();
        renderLevels();
        renderModules();
        renderAchievements();
        renderLeaderboard();
        renderReview();
        loadSettings();
    }

    // Page navigation
    function showPage(pageId) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const page = document.getElementById(pageId);
        if (page) page.classList.add('active');

        // Refresh data when navigating
        if (pageId === 'page-home') updateHomeStats();
        if (pageId === 'page-achievements') renderAchievements();
        if (pageId === 'page-leaderboard') renderLeaderboard();
        if (pageId === 'page-review') renderReview();
        if (pageId === 'page-levels') renderLevels();
    }

    // Update home page statistics
    function updateHomeStats() {
        const data = Storage.getData();
        document.getElementById('home-stars').textContent = data.stars;
        document.getElementById('home-coins').textContent = data.coins;
        document.getElementById('home-streak').textContent = data.streak;
    }

    // Render level selection
    function renderLevels() {
        const data = Storage.getData();
        const levels = Game.getLevels();
        const container = document.getElementById('level-path');
        container.innerHTML = '';

        levels.forEach(level => {
            const stars = data.levelStars[level.id.toString()] || 0;
            const unlocked = level.id <= data.levelsUnlocked;
            const isCurrent = level.id === data.levelsUnlocked;

            const card = document.createElement('div');
            card.className = `level-card ${unlocked ? 'unlocked' : 'locked'} ${isCurrent ? 'current' : ''}`;
            card.innerHTML = `
                <div class="level-number">${unlocked ? level.id : '🔒'}</div>
                <div class="level-info">
                    <h3>${level.nameCN}</h3>
                    <p>${level.description}</p>
                </div>
                <div class="level-stars">${'⭐'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
            `;

            if (unlocked) {
                card.onclick = () => Game.startLevel(level.id);
            }

            container.appendChild(card);
        });
    }

    // Render module selection grid
    async function renderModules() {
        const modules = await Game.loadModuleData();
        const container = document.getElementById('module-grid');
        if (!modules) return;
        container.innerHTML = '';

        modules.forEach(mod => {
            const card = document.createElement('div');
            card.className = 'module-card';
            card.innerHTML = `
                <div class="module-icon">${mod.icon}</div>
                <h3>${mod.nameCN}</h3>
                <p>${mod.name}</p>
                <p style="font-size:12px;color:var(--text-light);margin-top:4px;">
                    ${mod.words.length} 词 | ${mod.phrases.length} 短语 | ${mod.sentences.length} 句
                </p>
            `;
            card.onclick = () => openModuleDetail(mod);
            container.appendChild(card);
        });
    }

    // Open module detail
    function openModuleDetail(mod) {
        Game.setCurrentModule(mod.id);
        document.getElementById('module-detail-title').textContent = `${mod.icon} ${mod.nameCN} ${mod.name}`;
        showPage('page-module-detail');
    }

    // Render achievements/badges
    function renderAchievements() {
        const data = Storage.getData();
        document.getElementById('ach-stars').textContent = data.stars;
        document.getElementById('ach-coins').textContent = data.coins;
        document.getElementById('ach-badges').textContent = data.badges.length;

        const container = document.getElementById('badges-grid');
        container.innerHTML = '';

        ALL_BADGES.forEach(badge => {
            const earned = data.badges.includes(badge.id);
            const card = document.createElement('div');
            card.className = `badge-card ${earned ? 'earned' : 'locked'}`;
            card.innerHTML = `
                <div class="badge-icon">${badge.icon}</div>
                <div class="badge-name">${badge.name}</div>
                <div class="badge-desc">${badge.desc}</div>
            `;
            container.appendChild(card);
        });
    }

    // Render leaderboard
    function renderLeaderboard() {
        const data = Storage.getData();
        const container = document.getElementById('leaderboard-list');
        const nameInput = document.getElementById('player-name');
        if (nameInput) nameInput.value = data.playerName;

        if (data.leaderboard.length === 0) {
            container.innerHTML = '<p class="empty-message">暂无记录 No records yet. Play to get on the board!</p>';
            return;
        }

        container.innerHTML = '';
        data.leaderboard.forEach((entry, i) => {
            const rankClass = i === 0 ? 'gold' : (i === 1 ? 'silver' : (i === 2 ? 'bronze' : ''));
            const rankText = i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : (i + 1)));
            const div = document.createElement('div');
            div.className = 'lb-entry';
            div.innerHTML = `
                <span class="lb-rank ${rankClass}">${rankText}</span>
                <span class="lb-name">${entry.name}</span>
                <span class="lb-score">${entry.score} pts</span>
            `;
            container.appendChild(div);
        });
    }

    // Render wrong answer review
    function renderReview() {
        const data = Storage.getData();
        const container = document.getElementById('review-content');

        if (data.wrongAnswers.length === 0) {
            container.innerHTML = '<p class="empty-message">🎉 暂无错题记录 No wrong answers! Keep it up!</p>';
            return;
        }

        container.innerHTML = `<p style="margin-bottom:16px;color:var(--text-light);">
            共 ${data.wrongAnswers.length} 个错题 | ${data.wrongAnswers.length} items to review
        </p>`;

        data.wrongAnswers.slice(0, 30).forEach(item => {
            const div = document.createElement('div');
            div.className = 'review-item';
            div.innerHTML = `
                <div>
                    <div class="correct-answer">${item.en}</div>
                    <div class="hint">${item.cn}</div>
                    <div class="your-answer">你的答案: ${item.yourAnswer}</div>
                </div>
                <button class="btn btn-small btn-success" onclick="Storage.removeWrongAnswer('${item.en.replace(/'/g, "\\'")}');App.renderReview();">
                    ✓ 已掌握
                </button>
            `;
            container.appendChild(div);
        });
    }

    // Load settings
    function loadSettings() {
        const savedRate = localStorage.getItem('typing_game_rate');
        const savedSFX = localStorage.getItem('typing_game_sfx');
        const savedTheme = localStorage.getItem('typing_game_theme');

        if (savedRate) document.getElementById('setting-rate').value = savedRate;
        if (savedSFX) document.getElementById('setting-sfx').value = savedSFX;
        if (savedTheme) {
            document.getElementById('setting-theme').value = savedTheme;
            setTheme(savedTheme);
        }
    }

    // Set theme
    function setTheme(theme) {
        document.body.className = '';
        if (theme === 'space') document.body.className = 'theme-space';
        if (theme === 'adventure') document.body.className = 'theme-adventure';
        localStorage.setItem('typing_game_theme', theme);
    }

    return {
        init,
        showPage,
        updateHomeStats,
        renderReview,
        setTheme
    };
})();

// Start app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
