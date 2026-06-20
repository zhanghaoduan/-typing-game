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

    // ====== Phase 2: grade picker ======
    const GRADES = [
        { id: 1, nameCN: '小学', nameEN: 'Primary',     emoji: '🏫' },
        { id: 2, nameCN: '初中', nameEN: 'Junior High', emoji: '📘' },
        { id: 3, nameCN: '高中', nameEN: 'Senior High', emoji: '📗' },
        { id: 4, nameCN: '大学', nameEN: 'University',  emoji: '🎓' }
    ];

    function getSelectedGrade() {
        const v = parseInt(localStorage.getItem('selectedGrade'), 10);
        return [1, 2, 3, 4].includes(v) ? v : 2;  // default 初中
    }
    function setSelectedGrade(g) {
        localStorage.setItem('selectedGrade', String(g));
    }

    function renderGradePicker(containerId, onSelect) {
        const el = document.getElementById(containerId);
        if (!el) return;
        const cur = getSelectedGrade();
        el.innerHTML = GRADES.map(g => `
            <button class="grade-btn ${g.id === cur ? 'active' : ''}" data-grade="${g.id}">
                <span class="grade-emoji">${g.emoji}</span>
                <span class="grade-name">${g.nameCN}</span>
                <span class="grade-name-en">${g.nameEN}</span>
            </button>
        `).join('');
        el.querySelectorAll('.grade-btn').forEach(btn => {
            btn.onclick = () => {
                const g = parseInt(btn.dataset.grade, 10);
                setSelectedGrade(g);
                el.querySelectorAll('.grade-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (onSelect) onSelect(g);
            };
        });
    }

    // Render level selection (Phase 2: per-grade)
    function renderLevels() {
        renderGradePicker('levels-grade-picker', () => renderLevelsForGrade());
        renderLevelsForGrade();
    }

    function renderLevelsForGrade() {
        const grade = getSelectedGrade();
        const data = Storage.getData();
        const levels = Game.getGradeLevels();
        const gradeKey = 'g' + grade;
        const unlockKey = 'gradeLevelsUnlocked_' + gradeKey;
        const starsKey = 'gradeLevelStars_' + gradeKey;
        const unlockedRaw = parseInt(localStorage.getItem(unlockKey), 10);
        const unlocked = Number.isFinite(unlockedRaw) && unlockedRaw >= 1 ? unlockedRaw : 1;
        let starsMap = {};
        try { starsMap = JSON.parse(localStorage.getItem(starsKey) || '{}'); } catch (e) {}

        const container = document.getElementById('level-path');
        container.innerHTML = '';

        levels.forEach(level => {
            const earned = starsMap[level.id] || 0;
            const isUnlocked = level.id <= unlocked;
            const isCurrent = level.id === unlocked;

            const card = document.createElement('div');
            card.className = `level-card ${isUnlocked ? 'unlocked' : 'locked'} ${isCurrent ? 'current' : ''}`;
            card.innerHTML = `
                <div class="level-number">${isUnlocked ? level.id : '🔒'}</div>
                <div class="level-info">
                    <h3>第${level.id}关 · ${level.name}</h3>
                    <p>${level.desc}</p>
                </div>
                <div class="level-stars">${'⭐'.repeat(earned)}${'☆'.repeat(3 - earned)}</div>
            `;
            if (isUnlocked) {
                card.onclick = () => Game.startGradeLevel(grade, level.id);
            }
            container.appendChild(card);
        });
    }

    // Render module practice (Phase 2: grade random + legacy modules)
    async function renderModules() {
        renderGradePicker('modules-grade-picker', () => renderModulesForGrade());
        await renderModulesForGrade();
    }

    async function renderModulesForGrade() {
        const grade = getSelectedGrade();
        const container = document.getElementById('module-grid');
        if (!container) return;
        container.innerHTML = '';

        const QUICK = [
            { count: 10, icon: '⚡', nameCN: '快速练习', nameEN: 'Quick',  desc: '10 个单词 · 1~2 分钟' },
            { count: 20, icon: '🎯', nameCN: '标准练习', nameEN: 'Normal', desc: '20 个单词 · 3~5 分钟' },
            { count: 30, icon: '🔥', nameCN: '强化练习', nameEN: 'Intense', desc: '30 个单词 · 全面巩固' },
            { count: 50, icon: '🏅', nameCN: '马拉松',   nameEN: 'Marathon', desc: '50 个单词 · 终极挑战' }
        ];
        QUICK.forEach(q => {
            const card = document.createElement('div');
            card.className = 'module-card module-card-grade';
            card.innerHTML = `
                <div class="module-icon">${q.icon}</div>
                <h3>${q.nameCN}</h3>
                <p>${q.nameEN}</p>
                <p style="font-size:12px;color:var(--text-light);margin-top:4px;">${q.desc}</p>
            `;
            card.onclick = () => Game.startGradeRandom(grade, q.count);
            container.appendChild(card);
        });

        // Legacy themed modules (Animals/Sports/...) — kept for variety
        try {
            const modules = await Game.loadModuleData();
            if (modules && modules.length) {
                const sep = document.createElement('div');
                sep.className = 'module-section-sep';
                sep.innerHTML = '<span>主题模块 · Themed Modules</span>';
                container.appendChild(sep);

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
        } catch (e) { /* themed modules optional */ }
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

    // Render wrong answer review (server-side SRS + local fallback)
    async function renderReview() {
        const container = document.getElementById('review-content');
        const isLoggedIn = typeof AuthUI !== "undefined" && AuthUI.isLoggedIn && AuthUI.isLoggedIn();

        let stats = null, wrongItems = [];
        if (isLoggedIn) {
            try {
                const [s, wb] = await Promise.all([
                    AuthUI.apiRequest('/srs/stats'),
                    AuthUI.apiRequest('/srs/wrongbook?limit=200')
                ]);
                if (s && s.ok) stats = await s.json();
                if (wb && wb.ok) {
                    const data = await wb.json();
                    wrongItems = data.items || [];
                }
            } catch (_) {}
        }

        const localData = Storage.getData();
        // Fallback for guests / merge: surface local-only wrong answers as well
        if (!isLoggedIn || wrongItems.length === 0) {
            const seen = new Set(wrongItems.map(w => w.en.toLowerCase()));
            (localData.wrongAnswers || []).forEach(w => {
                if (!seen.has(w.en.toLowerCase())) {
                    wrongItems.push({
                        en: w.en, cn: w.cn || '', level: 0,
                        correct_count: 0, wrong_count: 1,
                        last_input: w.yourAnswer || '', _local: true
                    });
                }
            });
        }

        let html = '';
        if (stats) {
            html += `<div class="srs-stats">
                <div class="srs-stat"><span class="srs-stat-num">${stats.dueNow}</span><span class="srs-stat-label">今日待复习</span></div>
                <div class="srs-stat"><span class="srs-stat-num">${stats.wrongbook}</span><span class="srs-stat-label">错题</span></div>
                <div class="srs-stat"><span class="srs-stat-num">${stats.learning}</span><span class="srs-stat-label">学习中</span></div>
                <div class="srs-stat"><span class="srs-stat-num">${stats.mastered}</span><span class="srs-stat-label">已掌握</span></div>
            </div>`;
        }

        html += `<div class="review-actions">
            <button class="btn btn-primary" onclick="App.startDictationDue()">🎧 今日听写复习</button>
            <button class="btn btn-secondary" onclick="App.startDictationWrongbook()">📒 听写错题本</button>
            <button class="btn btn-outline" onclick="App.startDictationNew()">✨ 听写本年级新词</button>
        </div>`;

        if (wrongItems.length === 0) {
            html += '<p class="empty-message">🎉 暂无错题记录 No wrong answers!</p>';
            container.innerHTML = html;
            return;
        }

        html += `<p class="review-count">共 ${wrongItems.length} 个错题 | sorted by priority</p>`;
        html += '<div class="review-list">';
        wrongItems.slice(0, 100).forEach(item => {
            const en = (item.en || '').replace(/"/g, '&quot;');
            const cn = (item.cn || '').replace(/</g, '&lt;');
            const lvl = item.level || 0;
            const stars = '★'.repeat(lvl) + '☆'.repeat(5 - lvl);
            const wrong = item.wrong_count || 0;
            const correct = item.correct_count || 0;
            const lastInput = (item.last_input || '').replace(/</g, '&lt;');
            html += `<div class="review-item">
                <div class="review-item-main">
                    <div class="review-item-en">${en}</div>
                    <div class="review-item-cn">${cn}</div>
                    ${lastInput ? `<div class="review-item-input">上次输入: <code>${lastInput}</code></div>` : ''}
                    <div class="review-item-meta">
                        <span class="srs-level" title="掌握度">${stars}</span>
                        <span class="srs-counts">✓ ${correct} · ✗ ${wrong}</span>
                    </div>
                </div>
                <div class="review-item-actions">
                    <button class="btn btn-small btn-primary" onclick="App.startDictationOne('${en}','${cn.replace(/'/g, "\\'")}')">🎧 听写</button>
                    <button class="btn btn-small btn-success" onclick="App.markMastered('${en}')">✓ 已掌握</button>
                </div>
            </div>`;
        });
        html += '</div>';
        container.innerHTML = html;
    }

    async function startDictationDue() {
        if (!_requireLogin()) return;
        try {
            const r = await AuthUI.apiRequest('/srs/due?limit=20');
            const data = r && r.ok ? await r.json() : { items: [] };
            if (!data.items || data.items.length === 0) {
                alert('🎉 今天没有需要复习的单词了！可以试试"听写新词"。');
                return;
            }
            Game.startDictation(data.items);
        } catch (e) { alert('加载失败: ' + e.message); }
    }

    async function startDictationWrongbook() {
        if (!_requireLogin()) return;
        try {
            const r = await AuthUI.apiRequest('/srs/wrongbook?limit=20');
            const data = r && r.ok ? await r.json() : { items: [] };
            if (!data.items || data.items.length === 0) {
                alert('错题本是空的 🎉');
                return;
            }
            Game.startDictation(data.items);
        } catch (e) { alert('加载失败: ' + e.message); }
    }

    async function startDictationNew() {
        if (!_requireLogin()) return;
        // Map user grade to level 1..4
        const grade = (typeof AuthUI !== "undefined" && AuthUI.getUser && AuthUI.getUser() && AuthUI.getUser().grade) || '';
        let level = 2;
        if (/小学/.test(grade)) level = 1;
        else if (/初/.test(grade)) level = 2;
        else if (/高/.test(grade)) level = 3;
        try {
            const r = await fetch(`/api/practice/random?level=${level}&count=20`);
            const data = await r.json();
            if (!data.items || data.items.length === 0) {
                alert('词库为空');
                return;
            }
            Game.startDictation(data.items.map(it => ({ ...it, type: 'word' })));
        } catch (e) { alert('加载失败: ' + e.message); }
    }

    function startDictationOne(en, cn) {
        Game.startDictation([{ en, cn, type: 'word' }]);
    }

    async function markMastered(en) {
        if (!en) return;
        if (typeof AuthUI !== "undefined" && AuthUI.isLoggedIn && AuthUI.isLoggedIn()) {
            try {
                await AuthUI.apiRequest('/srs/word/' + encodeURIComponent(en), { method: 'DELETE' });
            } catch (_) {}
        }
        Storage.removeWrongAnswer(en);
        renderReview();
    }

    function _requireLogin() {
        if (typeof AuthUI !== "undefined" && AuthUI.isLoggedIn && AuthUI.isLoggedIn()) return true;
        alert('请先登录后使用听写训练');
        return false;
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
        if (theme === 'dark') document.body.className = 'theme-dark';
        if (theme === 'space') document.body.className = 'theme-space';
        if (theme === 'adventure') document.body.className = 'theme-adventure';
        localStorage.setItem('typing_game_theme', theme);
        const btn = document.getElementById('dark-toggle-btn');
        if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
        const sel = document.getElementById('setting-theme');
        if (sel) sel.value = theme;
    }

    function toggleDarkMode() {
        const cur = localStorage.getItem('typing_game_theme') || 'default';
        setTheme(cur === 'dark' ? 'default' : 'dark');
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
        else if (tabName === 'material') setupMaterialTab();
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

    // ============== ADMIN: SMART MATERIAL IMPORT ==============
    let materialFile = null;
    let materialUnit = null;
    let materialBound = false;

    function setupMaterialTab() {
        const input = document.getElementById('material-file-input');
        if (input && !materialBound) {
            input.addEventListener('change', () => {
                materialFile = input.files && input.files[0] ? input.files[0] : null;
                const nameEl = document.getElementById('material-file-name');
                const genBtn = document.getElementById('material-generate-btn');
                if (nameEl) nameEl.textContent = materialFile ? materialFile.name : '未选择文件 No file selected';
                if (genBtn) genBtn.disabled = !materialFile;
                const result = document.getElementById('material-result');
                if (result) { result.style.display = 'none'; result.innerHTML = ''; }
                materialUnit = null;
            });
            materialBound = true;
        }
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('文件读取失败 File read failed'));
            reader.readAsDataURL(file);
        });
    }

    async function generateMaterial() {
        if (!materialFile) { alert('请先选择文件 Please choose a file'); return; }
        const statusEl = document.getElementById('material-status');
        const resultEl = document.getElementById('material-result');
        const genBtn = document.getElementById('material-generate-btn');
        if (genBtn) genBtn.disabled = true;
        if (resultEl) { resultEl.style.display = 'none'; resultEl.innerHTML = ''; }
        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.className = 'material-status';
            statusEl.textContent = '正在提取并智能生成... Extracting & generating...';
        }
        try {
            const dataUrl = await readFileAsDataUrl(materialFile);
            const res = await AuthUI.apiRequest('/material/generate', {
                method: 'POST',
                body: JSON.stringify({
                    fileName: materialFile.name,
                    mimeType: materialFile.type || '',
                    fileData: dataUrl
                })
            });
            const data = await res.json();
            if (!res.ok) {
                if (statusEl) {
                    statusEl.className = 'material-status material-status-error';
                    statusEl.textContent = '❌ ' + (data.error || '生成失败 Generation failed');
                }
                return;
            }
            materialUnit = data.unit;
            const provider = data.provider === 'heuristic' ? '本地规则 (未配置AI)' : data.provider;
            if (statusEl) {
                statusEl.className = 'material-status material-status-ok';
                statusEl.textContent = `✅ 生成完成（来源: ${provider}，提取字符: ${data.charCount}）。请校对后保存。`;
            }
            renderMaterialResult(materialUnit);
        } catch (e) {
            if (statusEl) {
                statusEl.className = 'material-status material-status-error';
                statusEl.textContent = '❌ ' + (e.message || '生成失败 Generation failed');
            }
        } finally {
            if (genBtn) genBtn.disabled = false;
        }
    }

    function itemsToText(items) {
        return (items || []).map(it => {
            const en = (it && it.en) || '';
            const cn = (it && it.cn) || '';
            return cn ? `${en} | ${cn}` : en;
        }).join('\n');
    }

    function textToItems(text) {
        return String(text || '')
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => {
                const idx = line.indexOf('|');
                if (idx === -1) return { en: line.trim(), cn: '' };
                return { en: line.slice(0, idx).trim(), cn: line.slice(idx + 1).trim() };
            })
            .filter(it => it.en);
    }

    function renderMaterialResult(unit) {
        const el = document.getElementById('material-result');
        if (!el) return;
        const u = unit || {};
        el.style.display = 'block';
        el.innerHTML = `
            <h4>✏️ 校对生成结果 Proofread (格式：英文 | 中文，每行一条)</h4>
            <div class="material-meta-grid">
                <label>单元名 Name<input id="material-name" type="text" value="${escapeHtml(u.name || '')}"></label>
                <label>出版社 Publisher<input id="material-publisher" type="text" value="${escapeHtml(u.publisher || '')}"></label>
                <label>年级 Grade<input id="material-grade" type="text" value="${escapeHtml(u.grade || '')}"></label>
                <label>册 Book<input id="material-book" type="text" value="${escapeHtml(u.book || '')}"></label>
                <label>单元号 Unit No<input id="material-unitno" type="number" value="${parseInt(u.unit_no, 10) || 0}"></label>
            </div>
            <div class="material-cols">
                <div class="material-col">
                    <h5>📝 单词 Words (${(u.words || []).length})</h5>
                    <textarea id="material-words" rows="10">${escapeHtml(itemsToText(u.words))}</textarea>
                </div>
                <div class="material-col">
                    <h5>🔗 词组 Phrases (${(u.phrases || []).length})</h5>
                    <textarea id="material-phrases" rows="10">${escapeHtml(itemsToText(u.phrases))}</textarea>
                </div>
                <div class="material-col">
                    <h5>📖 句子 Sentences (${(u.sentences || []).length})</h5>
                    <textarea id="material-sentences" rows="10">${escapeHtml(itemsToText(u.sentences))}</textarea>
                </div>
            </div>
            <label class="material-public-row">
                <input type="checkbox" id="material-public" checked> 保存后设为公开（所有学生可练习）Publish to public library
            </label>
            <div class="material-actions">
                <button class="btn btn-primary" onclick="App.saveMaterialUnit()">💾 保存为练习单元 Save as Unit</button>
            </div>
        `;
    }

    async function saveMaterialUnit() {
        const words = textToItems(document.getElementById('material-words').value);
        const phrases = textToItems(document.getElementById('material-phrases').value);
        const sentences = textToItems(document.getElementById('material-sentences').value);
        const name = (document.getElementById('material-name').value || '').trim();
        const publisher = (document.getElementById('material-publisher').value || '').trim();
        const grade = (document.getElementById('material-grade').value || '').trim();
        const book = (document.getElementById('material-book').value || '').trim();
        const unit_no = parseInt(document.getElementById('material-unitno').value, 10) || 0;
        const makePublic = document.getElementById('material-public').checked;

        if (!name) { alert('请填写单元名 Please enter a unit name'); return; }
        if (words.length + phrases.length + sentences.length === 0) {
            alert('没有内容可保存 No content to save'); return;
        }

        try {
            const res = await AuthUI.apiRequest('/units', {
                method: 'POST',
                body: JSON.stringify({ name, words, phrases, sentences, publisher, grade, book, unit_no })
            });
            const data = await res.json();
            if (!res.ok) { alert(data.error || '保存失败 Save failed'); return; }

            if (makePublic && data.id) {
                await AuthUI.apiRequest(`/units/admin/toggle-public/${data.id}`, { method: 'POST' });
            }
            alert(`✅ 已保存 "${name}"\n单词: ${words.length} | 词组: ${phrases.length} | 句子: ${sentences.length}` +
                  (makePublic ? '\n已设为公开 Published as public' : ''));

            // Reset UI and refresh units list
            const result = document.getElementById('material-result');
            if (result) { result.style.display = 'none'; result.innerHTML = ''; }
            const statusEl = document.getElementById('material-status');
            if (statusEl) statusEl.style.display = 'none';
            const input = document.getElementById('material-file-input');
            if (input) input.value = '';
            materialFile = null;
            materialUnit = null;
            const nameEl = document.getElementById('material-file-name');
            if (nameEl) nameEl.textContent = '未选择文件 No file selected';
            const genBtn = document.getElementById('material-generate-btn');
            if (genBtn) genBtn.disabled = true;
        } catch (e) {
            alert('保存失败 Save failed');
        }
    }

    return {
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
        renderAdminRankings,
        generateMaterial,
        saveMaterialUnit,
        startDictationDue,
        startDictationWrongbook,
        startDictationNew,
        startDictationOne,
        markMastered,
        toggleDarkMode
    };
})();

// Start app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
