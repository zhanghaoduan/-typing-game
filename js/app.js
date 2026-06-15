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
        AuthUI.init();
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

        // Show login page if not logged in
        if (!AuthUI.isLoggedIn()) {
            showPage('page-login');
        } else {
            showPage('page-home');
        }
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
        if (pageId === 'page-admin') renderAdminPanel();
        if (pageId === 'page-profile') renderProfile();
        if (pageId === 'page-upload' && AuthUI.isLoggedIn()) {
            if (typeof ImageOCR !== 'undefined') ImageOCR.renderSavedUnits();
        }
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

    // Render admin panel
    async function renderAdminPanel() {
        if (!AuthUI.isAdmin()) return;
        const container = document.getElementById('admin-units-list');
        container.innerHTML = '<p class="empty-hint">加载中... Loading...</p>';

        try {
            const res = await AuthUI.apiRequest('/units/admin/all');
            const data = await res.json();

            if (!data.units || data.units.length === 0) {
                container.innerHTML = '<p class="empty-hint">暂无单元 No units yet</p>';
                return;
            }

            container.innerHTML = '';
            data.units.forEach(unit => {
                const totalItems = unit.words.length + unit.phrases.length + unit.sentences.length;
                const div = document.createElement('div');
                div.className = 'admin-unit-card';
                div.innerHTML = `
                    <div class="admin-unit-info">
                        <h4>${unit.name} ${unit.is_public ? '<span class="public-badge">公开</span>' : ''}</h4>
                        <p>作者: ${unit.author} | 单词: ${unit.words.length} | 词组: ${unit.phrases.length} | 句子: ${unit.sentences.length}</p>
                        <p class="unit-date">${new Date(unit.created_at).toLocaleDateString()}</p>
                    </div>
                    <div class="admin-unit-actions">
                        ${!unit.is_public ? `<button class="btn btn-small btn-primary" onclick="App.publishUnit(${unit.id})">📢 发布到公共库</button>` : ''}
                        <button class="btn btn-small btn-outline" onclick="App.togglePublic(${unit.id})">${unit.is_public ? '设为私有' : '设为公开'}</button>
                        <button class="btn btn-small btn-danger" onclick="App.deleteUnit(${unit.id})">🗑️ 删除</button>
                    </div>
                `;
                container.appendChild(div);
            });
        } catch (e) {
            container.innerHTML = '<p class="empty-hint">加载失败 Failed to load</p>';
        }
    }

    // Admin: publish unit to public library
    async function publishUnit(id) {
        try {
            const res = await AuthUI.apiRequest(`/units/admin/publish/${id}`, { method: 'POST' });
            const data = await res.json();
            alert(data.message);
            renderAdminPanel();
        } catch (e) {
            alert('操作失败 Operation failed');
        }
    }

    // Admin: toggle public status
    async function togglePublic(id) {
        try {
            const res = await AuthUI.apiRequest(`/units/admin/toggle-public/${id}`, { method: 'POST' });
            const data = await res.json();
            alert(data.message);
            renderAdminPanel();
        } catch (e) {
            alert('操作失败 Operation failed');
        }
    }

    // Delete unit
    async function deleteUnit(id) {
        if (!confirm('确认删除？ Confirm delete?')) return;
        try {
            await AuthUI.apiRequest(`/units/${id}`, { method: 'DELETE' });
            renderAdminPanel();
        } catch (e) {
            alert('删除失败 Delete failed');
        }
    }

    // Format ms -> "Xm Ys"
    function formatDuration(ms) {
        ms = Number(ms) || 0;
        const totalSec = Math.floor(ms / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        if (m === 0) return `${s}s`;
        return `${m}m ${s}s`;
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ============== PROFILE ==============
    async function renderProfile() {
        const basicEl = document.getElementById('profile-basic');
        const statsEl = document.getElementById('profile-stats');
        const histEl = document.getElementById('profile-history');
        if (!AuthUI.isLoggedIn()) {
            if (basicEl) basicEl.innerHTML = '<p class="empty-hint">请先登录 Please login</p>';
            return;
        }
        const user = AuthUI.getUser() || {};
        if (basicEl) {
            basicEl.innerHTML = `
                <div class="profile-info-row"><span>用户名 Username</span><strong>${escapeHtml(user.username)}</strong></div>
                <div class="profile-info-row"><span>角色 Role</span><strong>${user.role === 'admin' ? '👑 管理员 Admin' : '👤 用户 User'}</strong></div>
                <div class="profile-info-row"><span>用户ID User ID</span><strong>${user.id}</strong></div>
            `;
        }
        try {
            const res = await AuthUI.apiRequest('/me/stats');
            const json = await res.json();
            const s = (json && json.stats) || {};
            if (statsEl) {
                statsEl.innerHTML = `
                    <div class="profile-info-row"><span>⭐ 星星 Stars</span><strong>${s.stars || 0}</strong></div>
                    <div class="profile-info-row"><span>🪙 金币 Coins</span><strong>${s.coins || 0}</strong></div>
                    <div class="profile-info-row"><span>🔥 连续天数 Streak</span><strong>${s.streak || 0}</strong></div>
                    <div class="profile-info-row"><span>🎮 完成局数 Games Played</span><strong>${s.games_played || 0}</strong></div>
                    <div class="profile-info-row"><span>⏱️ 总时长 Total Time</span><strong>${formatDuration(s.total_time_ms)}</strong></div>
                    <div class="profile-info-row"><span>✅ 答对 Correct</span><strong>${s.total_correct || 0} / ${s.total_attempts || 0}</strong></div>
                `;
            }
        } catch (e) {
            if (statsEl) statsEl.innerHTML = '<p class="empty-hint">加载失败 Failed to load</p>';
        }
        try {
            const res = await AuthUI.apiRequest('/me/practice-history?limit=30');
            const json = await res.json();
            const list = (json && json.history) || [];
            if (histEl) {
                if (list.length === 0) {
                    histEl.innerHTML = '<p class="empty-hint">暂无练习记录 No practice records yet</p>';
                } else {
                    let html = '<table class="profile-history-table"><thead><tr>'
                        + '<th>时间 Time</th><th>类型 Kind</th><th>编号 Ref</th>'
                        + '<th>分数 Score</th><th>⭐</th><th>正确率 Acc</th><th>时长 Dur</th>'
                        + '</tr></thead><tbody>';
                    list.forEach(r => {
                        const acc = r.attempts > 0 ? Math.round((r.correct / r.attempts) * 100) + '%' : '-';
                        const t = r.created_at ? new Date(r.created_at + 'Z').toLocaleString() : '';
                        html += `<tr>
                            <td>${escapeHtml(t)}</td>
                            <td>${escapeHtml(r.kind)}</td>
                            <td>${escapeHtml(r.ref_id)}</td>
                            <td>${r.score}</td>
                            <td>${'⭐'.repeat(r.stars || 0)}</td>
                            <td>${acc}</td>
                            <td>${formatDuration(r.duration_ms)}</td>
                        </tr>`;
                    });
                    html += '</tbody></table>';
                    histEl.innerHTML = html;
                }
            }
        } catch (e) {
            if (histEl) histEl.innerHTML = '<p class="empty-hint">加载失败 Failed to load</p>';
        }
    }

    // ============== ADMIN TABS ==============
    function showAdminTab(tabName) {
        document.querySelectorAll('.admin-tab-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.adminTab === tabName);
        });
        document.querySelectorAll('.admin-tab-content').forEach(c => {
            c.style.display = 'none';
        });
        const target = document.getElementById('admin-tab-' + tabName);
        if (target) target.style.display = 'block';
        if (tabName === 'units') renderAdminPanel();
        else if (tabName === 'users') renderAdminUsers();
        else if (tabName === 'rankings') renderAdminRankings('score');
    }

    async function renderAdminUsers() {
        const container = document.getElementById('admin-users-list');
        if (!container) return;
        container.innerHTML = '<p class="empty-hint">加载中... Loading...</p>';
        try {
            const res = await AuthUI.apiRequest('/admin/users');
            const data = await res.json();
            const users = data.users || [];
            if (users.length === 0) {
                container.innerHTML = '<p class="empty-hint">暂无用户 No users</p>';
                return;
            }
            const me = AuthUI.getUser() || {};
            let html = '<table class="admin-users-table"><thead><tr>'
                + '<th>用户名 User</th><th>角色 Role</th><th>⭐</th><th>🪙</th><th>🔥</th>'
                + '<th>时长 Time</th><th>登录天数 Days</th><th>注册 Registered</th><th>操作 Actions</th>'
                + '</tr></thead><tbody>';
            users.forEach(u => {
                const isMe = u.id === me.id;
                const reg = u.created_at ? new Date(u.created_at + 'Z').toLocaleDateString() : '';
                html += `<tr>
                    <td>${escapeHtml(u.username)}</td>
                    <td>${u.role === 'admin' ? '👑 admin' : 'user'}</td>
                    <td>${u.stars || 0}</td>
                    <td>${u.coins || 0}</td>
                    <td>${u.streak || 0}</td>
                    <td>${formatDuration(u.total_time_ms)}</td>
                    <td>${u.login_days || 0}</td>
                    <td>${escapeHtml(reg)}</td>
                    <td>
                        <button class="btn btn-small btn-outline" onclick="App.adminResetPassword(${u.id}, '${escapeHtml(u.username).replace(/'/g, "\\'")}')">🔑 重置密码</button>
                        ${isMe ? '' : `<button class="btn btn-small btn-danger" onclick="App.adminDeleteUser(${u.id}, '${escapeHtml(u.username).replace(/'/g, "\\'")}')">🗑️ 删除</button>`}
                    </td>
                </tr>`;
            });
            html += '</tbody></table>';
            container.innerHTML = html;
        } catch (e) {
            container.innerHTML = '<p class="empty-hint">加载失败 Failed to load</p>';
        }
    }

    async function adminResetPassword(userId, username) {
        const newPassword = prompt(`为用户 "${username}" 设置新密码 (≥4 字符)\nNew password for "${username}":`);
        if (!newPassword) return;
        if (newPassword.length < 4) { alert('密码至少4个字符 Password must be at least 4 characters'); return; }
        try {
            const res = await AuthUI.apiRequest(`/admin/users/${userId}/reset-password`, {
                method: 'POST',
                body: JSON.stringify({ newPassword })
            });
            const data = await res.json();
            alert(data.message || (res.ok ? '已重置 Reset' : '失败 Failed'));
        } catch (e) {
            alert('操作失败 Operation failed');
        }
    }

    async function adminDeleteUser(userId, username) {
        if (!confirm(`确认删除用户 "${username}" 及其所有数据？\nDelete user "${username}" and all data?`)) return;
        try {
            const res = await AuthUI.apiRequest(`/admin/users/${userId}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) { alert(data.error || '删除失败 Delete failed'); return; }
            renderAdminUsers();
        } catch (e) {
            alert('删除失败 Delete failed');
        }
    }

    async function renderAdminRankings(type) {
        type = type || 'score';
        document.querySelectorAll('.rank-sub-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.rankType === type);
        });
        const container = document.getElementById('admin-rankings-list');
        if (!container) return;
        container.innerHTML = '<p class="empty-hint">加载中... Loading...</p>';
        try {
            const res = await AuthUI.apiRequest(`/admin/rankings?type=${encodeURIComponent(type)}&limit=50`);
            const data = await res.json();
            const list = data.rankings || [];
            if (list.length === 0) {
                container.innerHTML = '<p class="empty-hint">暂无数据 No data</p>';
                return;
            }
            const labelMap = {
                score: '总分 Total Score',
                time: '学习时长 Total Time',
                streak: '连续天数 Streak',
                login_days: '登录天数 Login Days'
            };
            let html = `<table class="admin-rankings-table"><thead><tr>
                <th>排名 Rank</th><th>用户 User</th><th>${labelMap[type]}</th></tr></thead><tbody>`;
            list.forEach(r => {
                const rankIcon = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : r.rank;
                let valStr;
                if (type === 'time') valStr = formatDuration(r.value);
                else valStr = r.value;
                html += `<tr><td>${rankIcon}</td><td>${escapeHtml(r.username)}</td><td>${valStr}</td></tr>`;
            });
            html += '</tbody></table>';
            container.innerHTML = html;
        } catch (e) {
            container.innerHTML = '<p class="empty-hint">加载失败 Failed to load</p>';
        }
    }

    return {
        init,
        showPage,
        updateHomeStats,
        renderReview,
        setTheme,
        renderAdminPanel,
        publishUnit,
        togglePublic,
        deleteUnit,
        renderProfile,
        showAdminTab,
        renderAdminUsers,
        adminResetPassword,
        adminDeleteUser,
        renderAdminRankings
    };
})();

// Start app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
