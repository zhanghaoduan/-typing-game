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
        if (pageId === 'page-material') {
            setupMaterialTab();
            renderMaterialUnits();
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
                <span class="lb-time">${entry.durationMs ? `⏱ ${formatDuration(entry.durationMs)}` : ''}</span>
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
        const savedPromptMode = getPromptMode();

        if (savedRate) document.getElementById('setting-rate').value = savedRate;
        if (savedSFX) document.getElementById('setting-sfx').value = savedSFX;
        const promptModeEl = document.getElementById('setting-prompt-mode');
        if (promptModeEl) promptModeEl.value = savedPromptMode;
        const gamePromptModeEl = document.getElementById('game-prompt-mode');
        if (gamePromptModeEl) gamePromptModeEl.value = savedPromptMode;
        if (savedTheme) {
            document.getElementById('setting-theme').value = savedTheme;
            setTheme(savedTheme);
        }
    }

    function getPromptMode() {
        return localStorage.getItem('typing_game_prompt_mode') || 'bilingual_speech';
    }

    function setPromptMode(mode) {
        const allowed = new Set([
            'bilingual_speech',
            'english_only',
            'chinese_only',
            'english_listening',
            'chinese_listening',
            'bilingual_silent'
        ]);
        const nextMode = allowed.has(mode) ? mode : 'bilingual_speech';
        localStorage.setItem('typing_game_prompt_mode', nextMode);
        const sel = document.getElementById('setting-prompt-mode');
        if (sel) sel.value = nextMode;
        const gameSel = document.getElementById('game-prompt-mode');
        if (gameSel) gameSel.value = nextMode;
        if (typeof Game !== 'undefined' && Game.refreshPrompt) Game.refreshPrompt();
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
            const units = await fetchAdminUnits(true);

            if (!units || units.length === 0) {
                container.innerHTML = '<p class="empty-hint">暂无单元 No units yet</p>';
                return;
            }

            container.innerHTML = '';
            units.forEach(unit => {
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
            adminUnitsCache = [];
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
            adminUnitsCache = [];
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
            adminUnitsCache = [];
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

    function formatPracticeTitle(row) {
        if (row && row.session_title) return row.session_title;
        const kind = String((row && row.kind) || '');
        const ref = String((row && row.ref_id) || '').trim();
        if (kind === 'material') return ref ? `老师标准 Unit ${ref}` : '老师标准练习';
        if (kind === 'module') return ref ? `主题模块 Module ${ref}` : '主题模块练习';
        if (kind === 'level') return ref ? `闯关 Level ${ref}` : '闯关练习';
        if (/^grade\d+-level$/.test(kind)) return ref ? `${kind} · ${ref}` : kind;
        if (/^grade\d+-random$/.test(kind)) return ref ? `${kind} · ${ref}` : kind;
        return ref ? `${kind} · ${ref}` : kind;
    }

    function renderPracticeWrongItems(items) {
        const list = Array.isArray(items) ? items : [];
        if (!list.length) return '<p class="empty-hint">本次无错题 No wrong answers in this session</p>';
        return list.map((item, idx) => `
            <div class="practice-wrong-item">
                <div><strong>${idx + 1}. ${escapeHtml(item.en || '')}</strong> <span class="practice-wrong-type">${escapeHtml(item.type || 'word')}</span></div>
                <div>中文：${escapeHtml(item.cn || '-')}</div>
                <div>你的答案：${escapeHtml(item.yourAnswer || '-')}</div>
            </div>
        `).join('');
    }

    function togglePracticeWrongbook(logId) {
        const row = document.getElementById(`practice-wrongbook-${logId}`);
        if (!row) return;
        const open = row.style.display !== 'none';
        row.style.display = open ? 'none' : 'table-row';
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
                        + '<th>时间 Time</th><th>练习内容 Content</th>'
                        + '<th>分数 Score</th><th>⭐</th><th>正确率 Acc</th><th>时长 Dur</th><th>错题 Wrongbook</th>'
                        + '</tr></thead><tbody>';
                    list.forEach(r => {
                        const acc = r.attempts > 0 ? Math.round((r.correct / r.attempts) * 100) + '%' : '-';
                        const t = r.created_at ? new Date(r.created_at + 'Z').toLocaleString() : '';
                        const title = formatPracticeTitle(r);
                        const wrongCount = Array.isArray(r.wrong_items) ? r.wrong_items.length : 0;
                        html += `<tr>
                            <td>${escapeHtml(t)}</td>
                            <td>${escapeHtml(title)}</td>
                            <td>${r.score}</td>
                            <td>${'⭐'.repeat(r.stars || 0)}</td>
                            <td>${acc}</td>
                            <td>${formatDuration(r.duration_ms)}</td>
                            <td>${wrongCount > 0
                                ? `<button class="btn btn-small btn-outline" onclick="App.togglePracticeWrongbook(${r.id})">查看 ${wrongCount} 题</button>`
                                : '<span class="empty-hint">无</span>'}</td>
                        </tr>`;
                        html += `<tr id="practice-wrongbook-${r.id}" class="practice-wrongbook-row" style="display:none;">
                            <td colspan="7">
                                <div class="practice-wrongbook-panel">
                                    <h4>📝 本次练习错题本 Session Wrongbook</h4>
                                    ${renderPracticeWrongItems(r.wrong_items)}
                                </div>
                            </td>
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
        else if (tabName === 'vocab-review') renderAdminVocabReview();
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

    let adminUnitsCache = [];

    async function fetchAdminUnits(forceRefresh) {
        if (!forceRefresh && adminUnitsCache.length) return adminUnitsCache;
        const res = await AuthUI.apiRequest('/units/admin/all');
        const data = await res.json();
        adminUnitsCache = data.units || [];
        return adminUnitsCache;
    }

    function findMatchingUnitEntries(report, units) {
        const enNeedle = String(report.en_text || '').trim().toLowerCase();
        if (!enNeedle) return [];
        const wantedTypes = report.item_type === 'phrase'
            ? ['phrases']
            : report.item_type === 'sentence'
            ? ['sentences']
            : ['words', 'phrases', 'sentences'];
        const matches = [];
        units.forEach(unit => {
            if (report.source_unit_id && String(unit.id) !== String(report.source_unit_id)) return;
            wantedTypes.forEach(field => {
                (unit[field] || []).forEach((item, index) => {
                    if (String(item.en || '').trim().toLowerCase() === enNeedle) {
                        matches.push({ unitId: unit.id, unitName: unit.name, field, index, currentCn: item.cn || '' });
                    }
                });
            });
        });
        return matches;
    }

    async function renderAdminVocabReview() {
        const container = document.getElementById('admin-vocab-reports-list');
        if (!container) return;
        container.innerHTML = '<p class="empty-hint">加载中... Loading...</p>';
        try {
            const [units, reportsRes] = await Promise.all([
                fetchAdminUnits(true),
                AuthUI.apiRequest('/admin/vocab-reports?status=all')
            ]);
            const data = await reportsRes.json();
            const reports = data.reports || [];
            if (!reports.length) {
                container.innerHTML = '<p class="empty-hint">暂无报错记录 No reports</p>';
                return;
            }
            container.innerHTML = reports.map(report => {
                const matches = findMatchingUnitEntries(report, units);
                const firstMatch = matches[0];
                const statusClass = report.status === 'open' ? 'vocab-review-card-open' : 'vocab-review-card-done';
                const statusLabel = report.status === 'open' ? '待处理 Open' : report.status === 'ignored' ? '已忽略 Ignored' : '已解决 Resolved';
                const matchText = firstMatch
                    ? `📚 ${escapeHtml(firstMatch.unitName)} / ${escapeHtml(firstMatch.field)}`
                    : '⚠️ 未自动定位到词条';
                return `<div class="vocab-review-card ${statusClass}">
                    <div class="vocab-review-head">
                        <strong>${escapeHtml(report.en_text)}</strong>
                        <span class="vocab-review-status">${statusLabel}</span>
                    </div>
                    <div class="vocab-review-meta">
                        <span>中文：${escapeHtml(report.cn_text || '-')}</span>
                        <span>类型：${escapeHtml(report.item_type || 'word')}</span>
                        <span>用户：${escapeHtml(report.username || '')}</span>
                        <span>时间：${escapeHtml(report.created_at || '')}</span>
                    </div>
                    <div class="vocab-review-note">${escapeHtml(report.note || '未填写说明 No note')}</div>
                    <div class="vocab-review-meta">
                        <span>${matchText}</span>
                        ${report.source_unit_name ? `<span>来源：${escapeHtml(report.source_unit_name)}</span>` : ''}
                    </div>
                    <div class="vocab-review-actions">
                        ${firstMatch ? `<button class="btn btn-small btn-outline" onclick='App.viewUnitSource(${firstMatch.unitId}, ${JSON.stringify(report.en_text || "")})'>🔎 查看词源</button>` : ''}
                        ${firstMatch ? `<button class="btn btn-small btn-outline" onclick="App.fixVocabReport(${report.id})">✏️ 修改对应词条</button>` : ''}
                        <button class="btn btn-small btn-outline" onclick="App.resolveVocabReport(${report.id}, 'resolved')">✅ 标记已解决</button>
                        <button class="btn btn-small btn-outline" onclick="App.resolveVocabReport(${report.id}, 'ignored')">🙈 忽略</button>
                        ${report.status !== 'open' ? `<button class="btn btn-small btn-outline" onclick="App.resolveVocabReport(${report.id}, 'open')">↩️ 恢复待处理</button>` : ''}
                    </div>
                </div>`;
            }).join('');
        } catch (e) {
            container.innerHTML = '<p class="empty-hint">加载失败 Failed to load</p>';
        }
    }

    async function resolveVocabReport(reportId, status) {
        const adminNote = status === 'ignored'
            ? (prompt('可选：输入忽略原因 Optional note') || '')
            : '';
        try {
            const res = await AuthUI.apiRequest(`/admin/vocab-reports/${reportId}/resolve`, {
                method: 'POST',
                body: JSON.stringify({ status, admin_note: adminNote })
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || '操作失败 Operation failed');
                return;
            }
            renderAdminVocabReview();
        } catch (e) {
            alert('操作失败 Operation failed');
        }
    }

    async function updateUnitEntryTranslation(unitId, field, index, newCn, relatedReportId) {
        const units = await fetchAdminUnits();
        const unit = units.find(u => String(u.id) === String(unitId));
        if (!unit) {
            alert('未找到对应单元 Unit not found');
            return;
        }
        const payload = {
            name: unit.name,
            words: Array.isArray(unit.words) ? unit.words.map(item => ({ ...item })) : [],
            phrases: Array.isArray(unit.phrases) ? unit.phrases.map(item => ({ ...item })) : [],
            sentences: Array.isArray(unit.sentences) ? unit.sentences.map(item => ({ ...item })) : [],
            publisher: unit.publisher || '',
            grade: unit.grade || '',
            book: unit.book || '',
            unit_no: unit.unit_no || 0
        };
        if (!payload[field] || !payload[field][index]) {
            alert('未找到对应词条 Entry not found');
            return;
        }
        payload[field][index].cn = newCn;
        const res = await AuthUI.apiRequest(`/units/${unitId}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || '保存失败 Save failed');
            return;
        }
        adminUnitsCache = [];
        await fetchAdminUnits(true);
        if (relatedReportId) {
            await AuthUI.apiRequest(`/admin/vocab-reports/${relatedReportId}/resolve`, {
                method: 'POST',
                body: JSON.stringify({ status: 'resolved', resolved_unit_id: unitId })
            });
        }
        renderAdminVocabReview();
    }

    async function fixVocabReport(reportId) {
        try {
            const reportsRes = await AuthUI.apiRequest('/admin/vocab-reports?status=all');
            const reportsData = await reportsRes.json();
            const report = (reportsData.reports || []).find(item => item.id === reportId);
            if (!report) {
                alert('未找到报错记录 Report not found');
                return;
            }
            const units = await fetchAdminUnits();
            const matches = findMatchingUnitEntries(report, units);
            if (!matches.length) {
                alert('未自动定位到对应词条，请先在单元管理中手动核对。');
                return;
            }
            const match = matches[0];
            const nextCn = prompt(
                `修改 ${report.en_text} 的中文释义\nEdit translation for ${report.en_text}\n\n当前：${match.currentCn || '(空)'}\n上报：${report.cn_text || '(空)'}\n说明：${report.note || '(无)'}`,
                match.currentCn || report.cn_text || ''
            );
            if (nextCn === null) return;
            await updateUnitEntryTranslation(match.unitId, match.field, match.index, nextCn.trim(), report.id);
        } catch (e) {
            alert('处理失败 Operation failed');
        }
    }

    async function runVocabAudit(scope) {
        const container = document.getElementById('admin-vocab-audit-list');
        if (!container) return;
        container.innerHTML = '<p class="empty-hint">核对中... Auditing...</p>';
        try {
            const res = await AuthUI.apiRequest(`/admin/vocab-audit?scope=${encodeURIComponent(scope || 'public')}&limit=80&suspiciousOnly=1`);
            const data = await res.json();
            const items = data.items || [];
            if (!items.length) {
                container.innerHTML = '<p class="empty-hint">暂未发现明显异常 No obvious issues found</p>';
                return;
            }
            container.innerHTML = items.map(item => {
                const dictText = (item.references && item.references.dictionary || [])
                    .map(ref => `${ref.pos ? ref.pos + '. ' : ''}${ref.def_cn || ''}`)
                    .filter(Boolean)
                    .join('；');
                const refText = [dictText, item.references && item.references.textbookTranslation].filter(Boolean).join(' / ');
                return `<div class="vocab-review-card vocab-review-card-open">
                    <div class="vocab-review-head">
                        <strong>${escapeHtml(item.en)}</strong>
                        <span class="vocab-review-status">疑似问题 Suspected</span>
                    </div>
                    <div class="vocab-review-meta">
                        <span>当前：${escapeHtml(item.cn || '(空)')}</span>
                        <span>单元：${escapeHtml(item.unitName || '')}</span>
                        <span>类别：${escapeHtml(item.field || '')}</span>
                    </div>
                    <div class="vocab-review-note">${escapeHtml(refText || '暂无词典参考 No reference')}</div>
                    <div class="vocab-review-meta">
                        <span>${escapeHtml((item.reasons || []).join('；') || '')}</span>
                    </div>
                    <div class="vocab-review-actions">
                        <button class="btn btn-small btn-outline" onclick='App.viewUnitSource(${item.unitId}, ${JSON.stringify(item.en || "")})'>🔎 查看词源</button>
                        <button class="btn btn-small btn-outline" onclick="App.fixVocabAuditEntry(${item.unitId}, '${item.field}', ${item.index})">✏️ 修改</button>
                    </div>
                </div>`;
            }).join('');
        } catch (e) {
            container.innerHTML = '<p class="empty-hint">核对失败 Audit failed</p>';
        }
    }

    function ensureSourceViewer() {
        let modal = document.getElementById('source-viewer-modal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'source-viewer-modal';
        modal.className = 'source-viewer-modal';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="source-viewer-dialog">
                <div class="source-viewer-header">
                    <h3>🔎 查看词源 Source Viewer</h3>
                    <button class="btn btn-small btn-outline" onclick="App.closeSourceViewer()">关闭 Close</button>
                </div>
                <div id="source-viewer-body" class="source-viewer-body"></div>
            </div>
        `;
        modal.addEventListener('click', (event) => {
            if (event.target === modal) closeSourceViewer();
        });
        document.body.appendChild(modal);
        return modal;
    }

    function closeSourceViewer() {
        const modal = document.getElementById('source-viewer-modal');
        if (!modal) return;
        modal.style.display = 'none';
        const body = document.getElementById('source-viewer-body');
        if (body) body.innerHTML = '';
    }

    async function openUnitSourceFile(unitId) {
        try {
            const res = await AuthUI.apiRequest(`/material/source/${unitId}/file`);
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                alert(data.error || '无法打开原始文件 Failed to open source file');
                return;
            }
            const blob = await res.blob();
            const blobUrl = URL.createObjectURL(blob);
            window.open(blobUrl, '_blank', 'noopener');
            setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
        } catch (e) {
            alert('无法打开原始文件 Failed to open source file');
        }
    }

    async function viewUnitSource(unitId, query) {
        const modal = ensureSourceViewer();
        const body = document.getElementById('source-viewer-body');
        if (!body) return;
        modal.style.display = 'flex';
        body.innerHTML = '<p class="empty-hint">加载中... Loading...</p>';
        try {
            const res = await AuthUI.apiRequest(`/material/source/${unitId}?q=${encodeURIComponent(query || '')}`);
            const data = await res.json();
            if (!res.ok) {
                body.innerHTML = `<p class="empty-hint">${escapeHtml(data.error || '加载失败 Failed to load')}</p>`;
                return;
            }
            const matchHtml = (data.matches || []).length
                ? (data.matches || []).map(line => `<div class="source-viewer-line">${escapeHtml(line)}</div>`).join('')
                : `<div class="source-viewer-line">${escapeHtml(data.previewText || '暂无匹配原文 No matched source text')}</div>`;
            body.innerHTML = `
                <div class="source-viewer-meta">
                    <div><strong>单元 Unit:</strong> ${escapeHtml(data.unitName || '')}</div>
                    <div><strong>查询词 Query:</strong> ${escapeHtml(query || '')}</div>
                    <div><strong>原始文件 File:</strong> ${escapeHtml(data.fileName || '暂无')}</div>
                </div>
                <div class="source-viewer-actions">
                    ${data.hasFile ? `<button class="btn btn-small btn-primary" onclick="App.openUnitSourceFile(${Number(unitId)})">📄 打开原始文件</button>` : '<span class="empty-hint">暂无原始文件，可先查看下方提取原文。</span>'}
                </div>
                <div class="source-viewer-section">
                    <h4>📌 匹配原文 Matched Source</h4>
                    <div class="source-viewer-pre">${matchHtml}</div>
                </div>
                <div class="source-viewer-section">
                    <h4>📚 提取文本 Preview</h4>
                    <pre class="source-viewer-pre">${escapeHtml(data.previewText || '暂无原文预览 No preview')}</pre>
                </div>
            `;
        } catch (e) {
            body.innerHTML = '<p class="empty-hint">加载失败 Failed to load</p>';
        }
    }

    async function fixVocabAuditEntry(unitId, field, index) {
        try {
            const units = await fetchAdminUnits();
            const unit = units.find(item => String(item.id) === String(unitId));
            const entry = unit && unit[field] && unit[field][index];
            if (!unit || !entry) {
                alert('未找到对应词条 Entry not found');
                return;
            }
            const nextCn = prompt(
                `修改 ${entry.en} 的中文释义\nEdit translation for ${entry.en}\n\n当前：${entry.cn || '(空)'}`,
                entry.cn || ''
            );
            if (nextCn === null) return;
            await updateUnitEntryTranslation(unitId, field, index, nextCn.trim());
            await runVocabAudit('public');
        } catch (e) {
            alert('保存失败 Save failed');
        }
    }

    // ============== ADMIN: SMART MATERIAL IMPORT ==============
    let materialFile = null;
    let materialUnit = null;
    let materialBound = false;
    let materialUnits = [];
    let materialEditingUnit = null;
    let materialGenUnits = [];

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
            const units = (Array.isArray(data.units) && data.units.length)
                ? data.units
                : (data.unit ? [data.unit] : []);
            if (!units.length) {
                if (statusEl) {
                    statusEl.className = 'material-status material-status-error';
                    statusEl.textContent = '❌ 未能识别到任何内容 No content recognized';
                }
                return;
            }
            // Teacher-provided Chinese is authoritative (教师标准); for items the
            // teacher left untranslated, fall back to the same lookup My Homework uses.
            units.forEach(fillMissingTranslations);
            materialGenUnits = units;
            materialEditingUnit = null;
            const provider = data.provider === 'heuristic' ? '本地规则 (未配置AI)' : data.provider;
            const totalItems = units.reduce((n, u) =>
                n + (u.words || []).length + (u.phrases || []).length + (u.sentences || []).length, 0);
            if (statusEl) {
                statusEl.className = 'material-status material-status-ok';
                statusEl.textContent = `✅ 识别完成：${units.length} 个单元 / ${totalItems} 项（来源: ${provider}）。已标识为教师标准材料，请校对后保存。`;
            }
            renderMaterialMultiResult(units);
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
                <input type="checkbox" id="material-public" ${u.is_public === 0 ? '' : 'checked'}> 保存后设为公开（所有学生可练习）Publish to public library
            </label>
            <div class="material-actions">
                <button class="btn btn-primary" onclick="App.saveMaterialUnit()">💾 ${materialEditingUnit ? '保存修改 Save Changes' : '保存为标准单元 Save as Unit'}</button>
                ${materialEditingUnit ? '<button class="btn btn-outline" onclick="App.cancelMaterialEdit()">取消 Cancel</button>' : ''}
            </div>
        `;
    }

    // -----------------------------------------------------------------------
    // Multi-unit teacher-material proofreading (image-2 style per-row editor)
    // -----------------------------------------------------------------------

    // Teacher CN is authoritative (教师标准). Items without CN fall back to the
    // same dictionary lookup My Homework uses.
    function fillMissingTranslations(unit) {
        ['words', 'phrases', 'sentences'].forEach(type => {
            (unit[type] || []).forEach(it => {
                const cn = (it.cn || '').trim();
                if (cn) {
                    it.cn = cn;
                    it.std = it.std !== false; // came from the file → teacher standard
                } else {
                    const t = (window.ImageOCR && ImageOCR.autoTranslate) ? ImageOCR.autoTranslate(it.en) : '';
                    it.cn = t || '';
                    it.std = false;
                }
            });
        });
    }

    function buildMaterialRow(uidx, type, idx, item) {
        const std = item && item.std;
        const badge = std
            ? '<span class="material-std-badge" title="教师提供的标准翻译">教师标准</span>'
            : '';
        const refEn = (item && item.en) || '';
        const refCn = (item && item.cn) || '';
        // The reference line shows the ORIGINAL file value so the admin can
        // compare while editing (revealed on focus via CSS :focus-within).
        const refLine = (refEn || refCn)
            ? `<div class="material-ref">📄 原文 Original：<b>${escapeHtml(refEn)}</b>${refCn ? ' = ' + escapeHtml(refCn) : ''}${std ? ' <span class="material-ref-tag">教师标准</span>' : ''}</div>`
            : '';
        return `<div class="proofread-item" data-uidx="${uidx}" data-type="${type}" data-idx="${idx}"
                 data-std="${std ? '1' : '0'}" data-ref-en="${escapeHtml(refEn)}" data-ref-cn="${escapeHtml(refCn)}">
            <span class="proofread-num">${idx + 1}.</span>
            <input type="text" class="proofread-en mat-en" value="${escapeHtml(item.en || '')}"
                   placeholder="English" data-uidx="${uidx}" data-type="${type}">
            <input type="text" class="proofread-cn mat-cn" value="${escapeHtml(item.cn || '')}"
                   placeholder="中文释义" data-uidx="${uidx}" data-type="${type}">
            ${badge}
            <button class="btn-icon btn-delete" onclick="App.removeMaterialRow(this)" title="删除">✕</button>
            ${refLine}
        </div>`;
    }

    function buildMaterialMeta(uidx, u) {
        return `<div class="material-meta-grid">
            <label>单元名 Name<input id="mat-${uidx}-name" type="text" value="${escapeHtml(u.name || '')}"></label>
            <label>出版社 Publisher<input id="mat-${uidx}-publisher" type="text" value="${escapeHtml(u.publisher || '')}"></label>
            <label>年级 Grade<input id="mat-${uidx}-grade" type="text" value="${escapeHtml(u.grade || '')}"></label>
            <label>册 Book<input id="mat-${uidx}-book" type="text" value="${escapeHtml(u.book || '')}"></label>
            <label>单元号 Unit No<input id="mat-${uidx}-unitno" type="number" value="${parseInt(u.unit_no, 10) || 0}"></label>
        </div>`;
    }

    function buildMaterialSection(uidx, type, title, items) {
        let rows = '';
        (items || []).forEach((item, idx) => { rows += buildMaterialRow(uidx, type, idx, item); });
        return `<div class="proofread-section" data-type="${type}">
            <div class="proofread-section-header">
                <h5>${title} (${(items || []).length})</h5>
                <button class="btn btn-small btn-outline" onclick="App.addMaterialRow('${uidx}', '${type}')">➕ 添加 Add</button>
            </div>
            <div class="proofread-items" id="mat-${uidx}-${type}">${rows}</div>
        </div>`;
    }

    function renderMaterialMultiResult(units) {
        const el = document.getElementById('material-result');
        if (!el) return;
        el.style.display = 'block';
        let html = `
            <div class="material-multi-head">
                <h4>✏️ 校对生成结果 · <span class="material-std-badge">教师标准材料</span>（共 ${units.length} 个单元）</h4>
                <p class="material-hint">中文优先使用老师提供的标准翻译（标记“教师标准”）；老师未提供的则自动查询翻译，可手动修改。点击某一项可对照原文。</p>
                <label class="material-public-row">
                    <input type="checkbox" id="material-public-all" checked> 保存后设为公开（所有学生可练习）Publish to public library
                </label>
                <div class="material-actions">
                    <button class="btn btn-primary" onclick="App.saveAllMaterialUnits()">💾 保存全部为标准单元 Save All (${units.length})</button>
                </div>
            </div>`;
        units.forEach((u, uidx) => {
            html += `
            <div class="material-unit-block" data-uidx="${uidx}">
                ${buildMaterialMeta(uidx, u)}
                ${buildMaterialSection(uidx, 'words', '📝 单词 Words', u.words)}
                ${buildMaterialSection(uidx, 'phrases', '🔗 词组 Phrases', u.phrases)}
                ${buildMaterialSection(uidx, 'sentences', '📖 句子 Sentences', u.sentences)}
                <div class="material-actions">
                    <button class="btn btn-secondary btn-small" onclick="App.saveOneMaterialUnit('${uidx}')">💾 保存此单元 Save This Unit</button>
                </div>
            </div>`;
        });
        el.innerHTML = html;
    }

    // Edit an existing saved standard unit using the same per-row editor (image-2
    // style) instead of the old textarea view, with original-value references.
    function renderMaterialEditor(unit) {
        const el = document.getElementById('material-result');
        if (!el) return;
        const u = unit || {};
        const uidx = 'edit';
        el.style.display = 'block';
        el.innerHTML = `
            <div class="material-multi-head">
                <h4>✏️ 编辑标准单元 Edit Unit · <span class="material-std-badge">教师标准材料</span></h4>
                <p class="material-hint">点击英文或中文输入框可对照下方“原文 Original”进行核对。修改后点击保存。</p>
            </div>
            <div class="material-unit-block" data-uidx="${uidx}">
                ${buildMaterialMeta(uidx, u)}
                ${buildMaterialSection(uidx, 'words', '📝 单词 Words', u.words)}
                ${buildMaterialSection(uidx, 'phrases', '🔗 词组 Phrases', u.phrases)}
                ${buildMaterialSection(uidx, 'sentences', '📖 句子 Sentences', u.sentences)}
                <label class="material-public-row">
                    <input type="checkbox" id="material-public-all" ${u.is_public ? 'checked' : ''}> 设为公开（所有学生可练习）Publish to public library
                </label>
                <div class="material-actions">
                    <button class="btn btn-primary" onclick="App.saveMaterialEditedUnit()">💾 保存修改 Save Changes</button>
                    <button class="btn btn-outline" onclick="App.cancelMaterialEdit()">取消 Cancel</button>
                </div>
            </div>`;
    }

    async function saveMaterialEditedUnit() {
        if (!materialEditingUnit || !materialEditingUnit.id) { alert('未找到要编辑的单元'); return; }
        const u = collectMaterialUnit('edit');
        if (!u.name) { alert('请填写单元名 Please enter a unit name'); return; }
        if (u.words.length + u.phrases.length + u.sentences.length === 0) {
            alert('没有内容可保存 No content to save'); return;
        }
        const pubEl = document.getElementById('material-public-all');
        const makePublic = pubEl ? pubEl.checked : false;
        try {
            const res = await AuthUI.apiRequest(`/units/${materialEditingUnit.id}`, {
                method: 'PUT',
                body: JSON.stringify(u)
            });
            const data = await res.json();
            if (!res.ok) { alert(data.error || '保存失败 Save failed'); return; }
            const currentlyPublic = !!materialEditingUnit.is_public;
            if (makePublic !== currentlyPublic) {
                await AuthUI.apiRequest(`/units/admin/toggle-public/${materialEditingUnit.id}`, { method: 'POST' });
            }
            alert(`✅ 已保存修改 "${u.name}"`);
            materialEditingUnit = null;
            const result = document.getElementById('material-result');
            if (result) { result.style.display = 'none'; result.innerHTML = ''; }
            const statusEl = document.getElementById('material-status');
            if (statusEl) statusEl.style.display = 'none';
            renderMaterialUnits();
        } catch (e) {
            alert('保存失败 Save failed');
        }
    }

    function addMaterialRow(uidx, type) {
        const container = document.getElementById(`mat-${uidx}-${type}`);
        if (!container) return;
        const idx = container.querySelectorAll('.proofread-item').length;
        const wrap = document.createElement('div');
        wrap.innerHTML = buildMaterialRow(uidx, type, idx, { en: '', cn: '', std: false });
        const row = wrap.firstElementChild;
        container.appendChild(row);
        const enInput = row.querySelector('.mat-en');
        if (enInput) enInput.focus();
    }

    function removeMaterialRow(btn) {
        const row = btn && btn.closest('.proofread-item');
        if (row && row.parentElement) row.parentElement.removeChild(row);
    }

    function collectMaterialUnit(uidx) {
        const val = id => {
            const node = document.getElementById(id);
            return node ? (node.value || '').trim() : '';
        };
        const pickSourceValue = (unit, key, draftKey) => {
            if (unit && unit[key] !== undefined) return unit[key];
            if (unit && unit[draftKey] !== undefined) return unit[draftKey];
            return undefined;
        };
        const collectType = type => {
            const items = [];
            const block = document.querySelector(`.material-unit-block[data-uidx="${uidx}"]`);
            if (!block) return items;
            block.querySelectorAll(`#mat-${uidx}-${type} .proofread-item`).forEach(row => {
                const en = (row.querySelector('.mat-en').value || '').trim();
                const cn = (row.querySelector('.mat-cn').value || '').trim();
                if (!en) return;
                // Preserve the teacher-standard flag only when the Chinese still
                // matches the file-provided original (an edited CN is no longer "standard").
                const std = row.getAttribute('data-std') === '1' && cn === (row.getAttribute('data-ref-cn') || '');
                items.push(std ? { en, cn, std: true } : { en, cn });
            });
            return items;
        };
        const sourceUnit = uidx === 'edit'
            ? (materialEditingUnit || materialUnit || {})
            : ((materialGenUnits && materialGenUnits[Number(uidx)]) || {});
        return {
            name: val(`mat-${uidx}-name`),
            publisher: val(`mat-${uidx}-publisher`),
            grade: val(`mat-${uidx}-grade`),
            book: val(`mat-${uidx}-book`),
            unit_no: parseInt(val(`mat-${uidx}-unitno`), 10) || 0,
            display_order: pickSourceValue(sourceUnit, 'display_order', '_displayOrder'),
            words: collectType('words'),
            phrases: collectType('phrases'),
            sentences: collectType('sentences'),
            source_file_name: pickSourceValue(sourceUnit, 'source_file_name', '_sourceFileName'),
            source_mime_type: pickSourceValue(sourceUnit, 'source_mime_type', '_sourceMimeType'),
            source_file_path: pickSourceValue(sourceUnit, 'source_file_path', '_sourceFilePath'),
            source_text: pickSourceValue(sourceUnit, 'source_text', '_sourceText')
        };
    }

    async function persistMaterialUnit(payload, makePublic) {
        const res = await AuthUI.apiRequest('/units', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '保存失败 Save failed');
        if (makePublic && data.id) {
            await AuthUI.apiRequest(`/units/admin/toggle-public/${data.id}`, { method: 'POST' });
        }
        return data.id;
    }

    async function saveOneMaterialUnit(uidx) {
        const u = collectMaterialUnit(uidx);
        if (!u.name) { alert('请填写单元名 Please enter a unit name'); return; }
        if (u.words.length + u.phrases.length + u.sentences.length === 0) {
            alert('没有内容可保存 No content to save'); return;
        }
        const pubEl = document.getElementById('material-public-all');
        const makePublic = pubEl ? pubEl.checked : true;
        try {
            await persistMaterialUnit(u, makePublic);
            alert(`✅ 已保存 "${u.name}"`);
            const block = document.querySelector(`.material-unit-block[data-uidx="${uidx}"]`);
            if (block) {
                block.style.opacity = '0.5';
                block.querySelectorAll('input, button').forEach(n => { n.disabled = true; });
            }
            renderMaterialUnits();
        } catch (e) {
            alert(e.message || '保存失败 Save failed');
        }
    }

    async function saveAllMaterialUnits() {
        const blocks = Array.from(document.querySelectorAll('.material-unit-block'))
            .filter(b => b.style.opacity !== '0.5');
        if (blocks.length === 0) { alert('没有可保存的单元 No units to save'); return; }
        const pubEl = document.getElementById('material-public-all');
        const makePublic = pubEl ? pubEl.checked : true;
        let saved = 0;
        const errors = [];
        for (const block of blocks) {
            const uidx = block.getAttribute('data-uidx');
            const u = collectMaterialUnit(uidx);
            if (!u.name) { errors.push(`单元 ${Number(uidx) + 1}: 缺少单元名`); continue; }
            if (u.words.length + u.phrases.length + u.sentences.length === 0) continue;
            try {
                await persistMaterialUnit(u, makePublic);
                saved++;
                block.style.opacity = '0.5';
                block.querySelectorAll('input, button').forEach(n => { n.disabled = true; });
            } catch (e) {
                errors.push(`单元 ${Number(uidx) + 1}: ${e.message || '保存失败'}`);
            }
        }
        let msg = `✅ 已保存 ${saved} 个标准单元` + (makePublic ? '（已公开 Published）' : '');
        if (errors.length) msg += `\n\n⚠️ ${errors.length} 个未保存:\n` + errors.join('\n');
        alert(msg);
        const statusEl = document.getElementById('material-status');
        if (statusEl) statusEl.style.display = 'none';
        if (saved > 0) {
            const input = document.getElementById('material-file-input');
            if (input) input.value = '';
            materialFile = null;
            const nameEl = document.getElementById('material-file-name');
            if (nameEl) nameEl.textContent = '未选择文件 No file selected';
            const genBtn = document.getElementById('material-generate-btn');
            if (genBtn) genBtn.disabled = true;
            const result = document.getElementById('material-result');
            if (result) { result.style.display = 'none'; result.innerHTML = ''; }
        }
        renderMaterialUnits();
    }

    function cancelMaterialEdit() {
        materialEditingUnit = null;
        const result = document.getElementById('material-result');
        if (result) { result.style.display = 'none'; result.innerHTML = ''; }
        const statusEl = document.getElementById('material-status');
        if (statusEl) statusEl.style.display = 'none';
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
        const sourceUnit = materialEditingUnit || materialUnit || {};
        const pickSourceValue = (unit, key, draftKey) => {
            if (unit && unit[key] !== undefined) return unit[key];
            if (unit && unit[draftKey] !== undefined) return unit[draftKey];
            return undefined;
        };
        const payload = {
            name, words, phrases, sentences, publisher, grade, book, unit_no,
            display_order: pickSourceValue(sourceUnit, 'display_order', '_displayOrder'),
            source_file_name: pickSourceValue(sourceUnit, 'source_file_name', '_sourceFileName'),
            source_mime_type: pickSourceValue(sourceUnit, 'source_mime_type', '_sourceMimeType'),
            source_file_path: pickSourceValue(sourceUnit, 'source_file_path', '_sourceFilePath'),
            source_text: pickSourceValue(sourceUnit, 'source_text', '_sourceText')
        };

        if (!name) { alert('请填写单元名 Please enter a unit name'); return; }
        if (words.length + phrases.length + sentences.length === 0) {
            alert('没有内容可保存 No content to save'); return;
        }

        try {
            let unitId;
            if (materialEditingUnit && materialEditingUnit.id) {
                // Update existing standard unit
                const res = await AuthUI.apiRequest(`/units/${materialEditingUnit.id}`, {
                    method: 'PUT',
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (!res.ok) { alert(data.error || '保存失败 Save failed'); return; }
                unitId = materialEditingUnit.id;
                // Sync public state if changed
                const currentlyPublic = !!materialEditingUnit.is_public;
                if (makePublic !== currentlyPublic) {
                    await AuthUI.apiRequest(`/units/admin/toggle-public/${unitId}`, { method: 'POST' });
                }
            } else {
                const res = await AuthUI.apiRequest('/units', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (!res.ok) { alert(data.error || '保存失败 Save failed'); return; }
                unitId = data.id;
                if (makePublic && unitId) {
                    await AuthUI.apiRequest(`/units/admin/toggle-public/${unitId}`, { method: 'POST' });
                }
            }
            alert(`✅ 已保存 "${name}"\n单词: ${words.length} | 词组: ${phrases.length} | 句子: ${sentences.length}` +
                  (makePublic ? '\n已设为公开 Published as public' : ''));

            // Reset UI and refresh units list
            materialEditingUnit = null;
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
            renderMaterialUnits();
        } catch (e) {
            alert('保存失败 Save failed');
        }
    }

    // Toggle the admin-only upload UI vs the student "public library" view.
    function setMaterialAdminUI(admin) {
        const adminArea = document.getElementById('material-admin-area');
        if (adminArea) adminArea.style.display = admin ? '' : 'none';
        const adminInstr = document.getElementById('material-admin-instructions');
        if (adminInstr) adminInstr.style.display = admin ? '' : 'none';
        const studentHint = document.getElementById('material-student-hint');
        if (studentHint) studentHint.style.display = admin ? 'none' : '';
        const listTitle = document.getElementById('material-list-title');
        if (listTitle) {
            listTitle.textContent = admin
                ? '📂 已保存的标准单元 Saved Standard Units'
                : '📚 老师公开的标准词库 Teacher Public Library';
        }
        const pageTitle = document.getElementById('material-page-title');
        if (pageTitle) {
            pageTitle.textContent = admin
                ? '🎓 老师标准单词句子文件上传 Teacher Standard Material'
                : '🎓 老师标准词库 Teacher Standard Library';
        }
    }

    function materialUnitCardHtml(unit, admin) {
        const w = (unit.words || []).length;
        const p = (unit.phrases || []).length;
        const s = (unit.sentences || []).length;
        const total = w + p + s;
        const meta = [unit.publisher, unit.grade, unit.book, unit.unit_no ? ('Unit ' + unit.unit_no) : '']
            .filter(Boolean).map(escapeHtml).join(' · ');
        const badge = admin
            ? (unit.is_public
                ? '<span class="unit-badge unit-badge-public">🌍 公开</span>'
                : '<span class="unit-badge">🔒 私有</span>')
            : '<span class="unit-badge unit-badge-public">🎓 老师标准</span>';
        const adminBtns = admin ? `
                        <button class="btn btn-small btn-outline" onclick="App.reorderMaterialUnit('${unit.id}','up')" title="上移 Move Up">↑</button>
                        <button class="btn btn-small btn-outline" onclick="App.reorderMaterialUnit('${unit.id}','down')" title="下移 Move Down">↓</button>
                        <button class="btn btn-small btn-info" onclick="App.editMaterialUnit('${unit.id}')" title="修改编辑">✏️</button>
                        <button class="btn btn-small btn-danger" onclick="App.deleteMaterialUnit('${unit.id}')" title="删除">🗑️</button>` : '';
        return `<div class="saved-unit-card">
                    <div class="saved-unit-info">
                        <h4>${escapeHtml(unit.name)} ${badge}</h4>
                        ${meta ? `<p>${meta}</p>` : ''}
                        <p>📝 ${w}词 + ${p}词组 + ${s}句子 = ${total}项</p>
                    </div>
                    <div class="saved-unit-actions">
                        <button class="btn btn-small btn-primary" onclick="App.practiceMaterialUnit('${unit.id}','words')">单词</button>
                        <button class="btn btn-small btn-secondary" onclick="App.practiceMaterialUnit('${unit.id}','phrases')">词组</button>
                        <button class="btn btn-small btn-accent" onclick="App.practiceMaterialUnit('${unit.id}','sentences')">句子</button>
                        <button class="btn btn-small btn-warning" onclick="App.practiceMaterialUnit('${unit.id}','listening')">听力</button>${adminBtns}
                    </div>
                </div>`;
    }

    // Render standard units. Admins see/manage their own; normal users see the
    // teacher's published (public) standard library with practice-only actions.
    async function renderMaterialUnits() {
        const container = document.getElementById('material-saved-list');
        if (!container) return;
        if (!AuthUI.isLoggedIn()) {
            container.innerHTML = '<p class="empty-hint">请先登录 Please login</p>';
            return;
        }
        const admin = AuthUI.isAdmin();
        setMaterialAdminUI(admin);
        container.innerHTML = '<p class="empty-hint">加载中... Loading...</p>';
        try {
            const res = await AuthUI.apiRequest('/units');
            const data = await res.json();
            materialUnits = admin ? (data.myUnits || []) : (data.publicUnits || []);
            if (materialUnits.length === 0) {
                container.innerHTML = admin
                    ? '<p class="empty-hint">暂无标准材料，请在下方上传生成 No standard material yet</p>'
                    : '<p class="empty-hint">老师还没有公开的标准词库 No public standard library yet</p>';
                return;
            }
            let html = '';
            materialUnits.forEach(unit => { html += materialUnitCardHtml(unit, admin); });
            container.innerHTML = html;
        } catch (e) {
            container.innerHTML = '<p class="empty-hint">加载失败 Load failed</p>';
        }
    }

    async function reorderMaterialUnit(id, direction) {
        try {
            const res = await AuthUI.apiRequest(`/units/admin/reorder/${id}`, {
                method: 'POST',
                body: JSON.stringify({ direction })
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || '排序失败 Reorder failed');
                return;
            }
            renderMaterialUnits();
        } catch (e) {
            alert('排序失败 Reorder failed');
        }
    }

    function findMaterialUnit(id) {
        return materialUnits.find(u => String(u.id) === String(id));
    }

    function practiceMaterialUnit(id, type) {
        const unit = findMaterialUnit(id);
        if (!unit) return;
        let items = [];
        if (type === 'words' || type === 'all' || type === 'listening') {
            (unit.words || []).forEach(w => items.push({ type: 'word', en: w.en, cn: w.cn || '(自定义)', difficulty: w.difficulty || 1, _sourceUnitId: unit.id, _sourceUnitName: unit.name, _sourceKind: 'material', _sourceField: 'words' }));
        }
        if (type === 'phrases' || type === 'all' || type === 'listening') {
            (unit.phrases || []).forEach(p => items.push({ type: 'phrase', en: p.en, cn: p.cn || '(自定义)', difficulty: p.difficulty || 2, _sourceUnitId: unit.id, _sourceUnitName: unit.name, _sourceKind: 'material', _sourceField: 'phrases' }));
        }
        if (type === 'sentences' || type === 'all') {
            (unit.sentences || []).forEach(s => items.push({ type: 'sentence', en: s.en, cn: s.cn || '(自定义)', difficulty: s.difficulty || 3, _sourceUnitId: unit.id, _sourceUnitName: unit.name, _sourceKind: 'material', _sourceField: 'sentences' }));
        }
        if (items.length === 0) { alert('该类别没有内容 No content in this category'); return; }
        for (let i = items.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [items[i], items[j]] = [items[j], items[i]];
        }
        Game.startCustomPractice(items, type === 'listening' ? 'listening' : 'mixed', {
            sessionKind: 'material',
            sessionRefId: unit.id,
            sessionTitle: `老师标准 ${unit.name} · ${type === 'words' ? '单词' : type === 'phrases' ? '词组' : type === 'sentences' ? '句子' : '听力'}`
        });
    }

    function editMaterialUnit(id) {
        const unit = findMaterialUnit(id);
        if (!unit) return;
        materialEditingUnit = unit;
        materialUnit = unit;
        renderMaterialEditor(unit);
        const statusEl = document.getElementById('material-status');
        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.className = 'material-status material-status-ok';
            statusEl.textContent = `✏️ 正在编辑 "${unit.name}"，修改后点击保存。Editing — save to apply.`;
        }
        const result = document.getElementById('material-result');
        if (result && result.scrollIntoView) result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async function deleteMaterialUnit(id) {
        const unit = findMaterialUnit(id);
        if (!unit) return;
        if (!confirm(`确定删除标准单元 "${unit.name}"？\nConfirm delete?`)) return;
        try {
            const res = await AuthUI.apiRequest(`/units/${id}`, { method: 'DELETE' });
            if (!res.ok) { alert('删除失败 Delete failed'); return; }
            renderMaterialUnits();
        } catch (e) {
            alert('删除失败 Delete failed');
        }
    }

    return {
        init,
        showPage,
        updateHomeStats,
        renderReview,
        setTheme,
        setPromptMode,
        getPromptMode,
        renderAdminPanel,
        publishUnit,
        togglePublic,
        deleteUnit,
        renderProfile,
        togglePracticeWrongbook,
        showAdminTab,
        renderAdminUsers,
        adminResetPassword,
        adminDeleteUser,
        renderAdminRankings,
        renderAdminVocabReview,
        runVocabAudit,
        fixVocabAuditEntry,
        resolveVocabReport,
        fixVocabReport,
        viewUnitSource,
        openUnitSourceFile,
        closeSourceViewer,
        generateMaterial,
        saveMaterialUnit,
        saveOneMaterialUnit,
        saveAllMaterialUnits,
        saveMaterialEditedUnit,
        addMaterialRow,
        removeMaterialRow,
        renderMaterialUnits,
        reorderMaterialUnit,
        practiceMaterialUnit,
        editMaterialUnit,
        deleteMaterialUnit,
        cancelMaterialEdit,
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
