/* ============================================
   Game Engine Module - Core gameplay logic
   游戏引擎模块
   ============================================ */

const Game = (() => {
    // Game state
    let state = {
        mode: null,          // 'words', 'phrases', 'sentences', 'listening', 'mixed'
        level: 1,
        items: [],           // Current set of items to type
        currentIndex: 0,
        score: 0,
        combo: 0,
        maxCombo: 0,
        lives: 3,
        maxLives: 3,
        correct: 0,
        wrong: 0,
        totalItems: 0,
        timer: null,
        timeLeft: 0,
        timeTotal: 0,
        startTime: null,
        pausedDurationMs: 0,
        pauseStartedAt: null,
        isPaused: false,
        isLevelMode: false,
        currentModule: null,
        coinsEarned: 0,
        grade: null,
        sessionTitle: '',
        sessionWrongAnswers: []
    };

    // Track whether current item has been reported to SRS (one report per item)
    let _srsReportedForIndex = -1;

    // Report a single answer to server-side SRS (best-effort, non-blocking)
    function reportSrs(item, correct, input) {
        if (!item || item.type !== 'word' || !item.en) return;
        try {
            if (typeof AuthUI === 'undefined' || !AuthUI.isLoggedIn || !AuthUI.isLoggedIn()) return;
            const headers = { 'Content-Type': 'application/json' };
            const tok = (AuthUI.getToken && AuthUI.getToken()) || localStorage.getItem('auth_token');
            if (tok) headers['Authorization'] = 'Bearer ' + tok;
            fetch('/api/srs/answer', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    en: item.en,
                    cn: item.cn || '',
                    correct: !!correct,
                    input: typeof input === 'string' ? input.slice(0, 200) : ''
                })
            }).catch(() => {});
        } catch (_) {}
    }
    const LEVELS = [
        {
            id: 1, name: "单词入门 Word Basics",
            nameCN: "第一关：单词入门", description: "Type basic words 输入基础单词",
            mode: 'words', difficulty: 1, itemCount: 10, timeLimit: 0,
            passScore: 60, lives: 99
        },
        {
            id: 2, name: "短语挑战 Phrase Challenge",
            nameCN: "第二关：短语挑战", description: "Type short phrases 输入短语",
            mode: 'phrases', difficulty: 1, itemCount: 8, timeLimit: 0,
            passScore: 60, lives: 99
        },
        {
            id: 3, name: "句子攻关 Sentence Stage",
            nameCN: "第三关：句子攻关", description: "Type full sentences 输入完整句子",
            mode: 'sentences', difficulty: 1, itemCount: 6, timeLimit: 0,
            passScore: 50, lives: 99
        },
        {
            id: 4, name: "听力测试 Listening Test",
            nameCN: "第四关：听力测试", description: "Listen and type 听力输入",
            mode: 'listening', difficulty: 2, itemCount: 8, timeLimit: 0,
            passScore: 60, lives: 99
        },
        {
            id: 5, name: "混合挑战 Mixed Challenge",
            nameCN: "第五关：混合挑战", description: "Mixed fast challenge 快速混合挑战",
            mode: 'mixed', difficulty: 2, itemCount: 12, timeLimit: 0,
            passScore: 70, lives: 99
        },
        {
            id: 6, name: "进阶单词 Advanced Words",
            nameCN: "第六关：进阶单词", description: "Harder vocabulary 高难度词汇",
            mode: 'words', difficulty: 2, itemCount: 12, timeLimit: 0,
            passScore: 65, lives: 99
        },
        {
            id: 7, name: "长句挑战 Long Sentences",
            nameCN: "第七关：长句挑战", description: "Type longer sentences 输入长句",
            mode: 'sentences', difficulty: 2, itemCount: 8, timeLimit: 0,
            passScore: 60, lives: 99
        },
        {
            id: 8, name: "听写大师 Dictation Master",
            nameCN: "第八关：听写大师", description: "Advanced listening 高级听力",
            mode: 'listening', difficulty: 2, itemCount: 10, timeLimit: 0,
            passScore: 65, lives: 99
        },
        {
            id: 9, name: "极速挑战 Speed Rush",
            nameCN: "第九关：极速挑战", description: "Type as fast as you can! 极速输入！",
            mode: 'mixed', difficulty: 3, itemCount: 15, timeLimit: 0,
            passScore: 70, lives: 99
        },
        {
            id: 10, name: "终极Boss Ultimate Boss",
            nameCN: "第十关：终极BOSS", description: "The final challenge! 最终挑战！",
            mode: 'mixed', difficulty: 3, itemCount: 20, timeLimit: 0,
            passScore: 75, lives: 99
        }
    ];

    // Module data cache
    let moduleData = null;

    // Load module data from JSON
    async function loadModuleData() {
        if (moduleData) return moduleData;
        try {
            const response = await fetch('data/modules.json');
            const data = await response.json();
            moduleData = data.modules;
            return moduleData;
        } catch (err) {
            console.error('Failed to load module data:', err);
            return [];
        }
    }

    function getElapsedMs() {
        const startTime = state.startTime || Date.now();
        const pausedDuration = state.pausedDurationMs || 0;
        const currentPause = state.pauseStartedAt ? (Date.now() - state.pauseStartedAt) : 0;
        return Math.max(0, Date.now() - startTime - pausedDuration - currentPause);
    }

    function formatElapsedMs(ms) {
        const totalSec = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
        const minutes = Math.floor(totalSec / 60);
        const seconds = totalSec % 60;
        if (minutes === 0) return `${seconds}s`;
        return `${minutes}m ${seconds}s`;
    }

    function updateElapsedDisplay() {
        const elapsedEl = document.getElementById('game-elapsed');
        if (elapsedEl) elapsedEl.textContent = formatElapsedMs(getElapsedMs());
    }

    function updatePauseControls() {
        const pauseBtn = document.getElementById('btn-pause-game');
        const resumeBtn = document.getElementById('btn-resume-game');
        const inputEl = document.getElementById('game-input');
        const submitBtn = document.getElementById('btn-submit');
        if (pauseBtn) pauseBtn.style.display = state.isPaused ? 'none' : 'inline-flex';
        if (resumeBtn) resumeBtn.style.display = state.isPaused ? 'inline-flex' : 'none';
        if (inputEl) inputEl.disabled = !!state.isPaused;
        if (submitBtn) submitBtn.disabled = !!state.isPaused;
    }

    function getPromptModeConfig() {
        const mode = (typeof App !== 'undefined' && App.getPromptMode)
            ? App.getPromptMode()
            : 'bilingual_speech';
        switch (mode) {
        case 'english_only':
            return { showEnglish: true, showChinese: false, autoSpeak: false, audioText: '', audioLang: 'en-US', answerTools: true, listeningStyle: false, targetUsesChinese: false };
        case 'chinese_only':
            return { showEnglish: false, showChinese: false, autoSpeak: false, audioText: '', audioLang: 'zh-CN', answerTools: true, listeningStyle: false, targetUsesChinese: true };
        case 'english_listening':
            return { showEnglish: false, showChinese: false, autoSpeak: true, audioText: 'english', audioLang: 'en-US', answerTools: true, listeningStyle: true, targetUsesChinese: false };
        case 'chinese_listening':
            return { showEnglish: false, showChinese: false, autoSpeak: true, audioText: 'chinese', audioLang: 'zh-CN', answerTools: true, listeningStyle: true, targetUsesChinese: false };
        case 'bilingual_silent':
            return { showEnglish: true, showChinese: true, autoSpeak: false, audioText: '', audioLang: 'en-US', answerTools: true, listeningStyle: false, targetUsesChinese: false };
        default:
            return { showEnglish: true, showChinese: true, autoSpeak: true, audioText: 'english', audioLang: 'en-US', answerTools: true, listeningStyle: false, targetUsesChinese: false };
        }
    }

    function sanitizeChineseSpeechText(text) {
        return String(text || '')
            .replace(/^\s*(?:(?:n|v|vi|vt|adj|adv|prep|pron|conj|int|num|art|aux|modal(?:\s+v)?)\s*\.)+\s*/i, '')
            .trim();
    }

    function renderAnswerExplanation(item) {
        const feedbackEl = document.getElementById('feedback-area');
        if (!feedbackEl || !item) return;
        feedbackEl.className = 'feedback-area feedback-answer';
        feedbackEl.innerHTML = `💡 答案 Answer: <strong>${escapeHtml(item.en || '')}</strong>${item.cn ? ` <span class="answer-cn">= ${escapeHtml(item.cn)}</span>` : ''}<div class="dict-panels" id="dict-panels-answer-${state.currentIndex}"><div class="dict-loading">📖 正在查询词典…</div></div>`;
        renderDictPanels(item.en, '', `dict-panels-answer-${state.currentIndex}`);
    }

    // Get random items from modules based on mode and difficulty
    function getItems(mode, difficulty, count, moduleId = null) {
        if (!moduleData) return [];

        let pool = [];
        const modules = moduleId
            ? moduleData.filter(m => m.id === moduleId)
            : moduleData;

        modules.forEach(mod => {
            if (mode === 'words' || mode === 'mixed') {
                mod.words.filter(w => w.difficulty <= difficulty).forEach(w => {
                    pool.push({ type: 'word', en: w.en, cn: w.cn, difficulty: w.difficulty });
                });
            }
            if (mode === 'phrases' || mode === 'mixed') {
                mod.phrases.filter(p => p.difficulty <= difficulty).forEach(p => {
                    pool.push({ type: 'phrase', en: p.en, cn: p.cn, difficulty: p.difficulty });
                });
            }
            if (mode === 'sentences' || mode === 'mixed') {
                mod.sentences.filter(s => s.difficulty <= difficulty).forEach(s => {
                    pool.push({ type: 'sentence', en: s.en, cn: s.cn, difficulty: s.difficulty });
                });
            }
            if (mode === 'listening') {
                // For listening mode, use words and phrases
                mod.words.filter(w => w.difficulty <= difficulty).forEach(w => {
                    pool.push({ type: 'word', en: w.en, cn: w.cn, difficulty: w.difficulty });
                });
                mod.phrases.filter(p => p.difficulty <= difficulty).forEach(p => {
                    pool.push({ type: 'phrase', en: p.en, cn: p.cn, difficulty: p.difficulty });
                });
            }
        });

        // Shuffle and pick
        pool = shuffleArray(pool);
        return pool.slice(0, count);
    }

    // Shuffle array (Fisher-Yates)
    function shuffleArray(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function getGradeLabel(grade) {
        const map = {
            1: '小学 Primary',
            2: '初中 Junior High',
            3: '高中 Senior High',
            4: '大学 University'
        };
        return map[Number(grade)] || `Grade ${grade}`;
    }

    function getModeLabel(mode) {
        const map = {
            words: '单词',
            phrases: '词组',
            sentences: '句子',
            listening: '听力',
            mixed: '综合'
        };
        return map[mode] || '练习';
    }

    function getSessionTitleFromItems(items, mode) {
        const first = Array.isArray(items) && items.length ? items[0] : null;
        if (first && first._sourceKind === 'material' && first._sourceUnitName) {
            return `老师标准 ${first._sourceUnitName} · ${getModeLabel(mode)}`;
        }
        return '';
    }

    function buildSessionTitle() {
        if (state.sessionTitle) return state.sessionTitle;
        if (state.isLevelMode && !state.grade) {
            const levelDef = LEVELS[state.level - 1];
            return levelDef ? `闯关 ${levelDef.nameCN}` : `闯关 Level ${state.level}`;
        }
        if (state.grade && state.isLevelMode) {
            const def = GRADE_LEVELS.find(item => item.id === state.level);
            return `${getGradeLabel(state.grade)} · ${def ? def.name : ('Level ' + state.level)}`;
        }
        if (state.grade) {
            return `${getGradeLabel(state.grade)} · ${state.totalItems}词练习`;
        }
        if (state.currentModule && Array.isArray(moduleData)) {
            const mod = moduleData.find(item => item.id === state.currentModule);
            if (mod) return `主题模块 ${mod.nameCN} ${mod.name}`;
        }
        return `${getModeLabel(state.mode)}练习`;
    }

    function recordSessionWrongAnswer(item, answer) {
        if (!item || !item.en) return;
        if (!Array.isArray(state.sessionWrongAnswers)) state.sessionWrongAnswers = [];
        const key = `${item.type || 'word'}::${String(item.en).toLowerCase()}`;
        const existing = state.sessionWrongAnswers.find(entry => entry.key === key);
        const payload = {
            key,
            en: item.en || '',
            cn: item.cn || '',
            yourAnswer: String(answer || '').trim(),
            type: item.type || 'word'
        };
        if (existing) {
            existing.yourAnswer = payload.yourAnswer;
            existing.cn = payload.cn;
        } else {
            state.sessionWrongAnswers.push(payload);
        }
    }

    // Start a level (level mode)
    async function startLevel(levelId) {
        const data = Storage.getData();
        if (levelId > data.levelsUnlocked) return; // Can't play locked levels

        await loadModuleData();
        const levelDef = LEVELS[levelId - 1];
        if (!levelDef) return;

        const items = getItems(levelDef.mode, levelDef.difficulty, levelDef.itemCount);
        if (items.length === 0) return;

        state = {
            mode: levelDef.mode,
            level: levelId,
            items: items,
            currentIndex: 0,
            score: 0,
            combo: 0,
            maxCombo: 0,
            lives: levelDef.lives,
            maxLives: levelDef.lives,
            correct: 0,
            wrong: 0,
            totalItems: items.length,
            timer: null,
            timeLeft: levelDef.timeLimit,
            timeTotal: levelDef.timeLimit,
            startTime: Date.now(),
            pausedDurationMs: 0,
            pauseStartedAt: null,
            isPaused: false,
            isLevelMode: true,
            currentModule: null,
            coinsEarned: 0,
            grade: null,
            sessionTitle: `闯关 ${levelDef.nameCN}`,
            sessionWrongAnswers: []
        };

        initGameUI();
        startTimer();
        showCurrentItem();
    }

    // Start module practice
    async function startModulePractice(mode) {
        await loadModuleData();
        const moduleId = state.currentModule;
        const items = getItems(mode, 3, 10, moduleId); // All difficulties
        if (items.length === 0) return;

        state = {
            mode: mode,
            level: 0,
            items: items,
            currentIndex: 0,
            score: 0,
            combo: 0,
            maxCombo: 0,
            lives: 99,
            maxLives: 99,
            correct: 0,
            wrong: 0,
            totalItems: items.length,
            timer: null,
            timeLeft: 0,
            timeTotal: 0,
            startTime: Date.now(),
            pausedDurationMs: 0,
            pauseStartedAt: null,
            isPaused: false,
            isLevelMode: false,
            currentModule: moduleId,
            coinsEarned: 0,
            grade: null,
            sessionTitle: '',
            sessionWrongAnswers: []
        };
        state.sessionTitle = buildSessionTitle();

        initGameUI();
        startTimer();
        showCurrentItem();
    }

    // Start custom practice (from OCR image upload)
    function startCustomPractice(items, mode) {
        if (!items || items.length === 0) return;

        state = {
            mode: mode,
            level: 0,
            items: items,
            currentIndex: 0,
            score: 0,
            combo: 0,
            maxCombo: 0,
            lives: 99,
            maxLives: 99,
            correct: 0,
            wrong: 0,
            totalItems: items.length,
            timer: null,
            timeLeft: 0,
            timeTotal: 0,
            startTime: Date.now(),
            pausedDurationMs: 0,
            pauseStartedAt: null,
            isPaused: false,
            isLevelMode: false,
            currentModule: null,
            coinsEarned: 0,
            grade: null,
            sessionTitle: getSessionTitleFromItems(items, mode),
            sessionWrongAnswers: []
        };

        initGameUI();
        startTimer();
        showCurrentItem();
    }

    // Start dictation (听写训练) — items are {en,cn,type:'word'}; uses listening mode
    function startDictation(items) {
        if (!items || items.length === 0) return;
        _srsReportedForIndex = -1;
        state = {
            mode: 'listening',
            level: 0,
            items: items,
            currentIndex: 0,
            score: 0,
            combo: 0,
            maxCombo: 0,
            lives: 99,
            maxLives: 99,
            correct: 0,
            wrong: 0,
            totalItems: items.length,
            timer: null,
            timeLeft: 0,
            timeTotal: 0,
            startTime: Date.now(),
            pausedDurationMs: 0,
            pauseStartedAt: null,
            isPaused: false,
            isLevelMode: false,
            currentModule: null,
            coinsEarned: 0,
            grade: null,
            sessionTitle: '听写训练 Dictation',
            sessionWrongAnswers: []
        };
        initGameUI();
        startTimer();
        showCurrentItem();
    }
    // Initialize game UI
    function initGameUI() {
        _srsReportedForIndex = -1;
        App.showPage('page-game');
        document.getElementById('game-level').textContent = state.isLevelMode ? state.level : '练习';
        document.getElementById('game-score').textContent = '0';
        document.getElementById('game-combo').textContent = '0';
        document.getElementById('game-wpm').textContent = '0';
        document.getElementById('game-accuracy').textContent = '100%';
        const promptSelect = document.getElementById('game-prompt-mode');
        if (promptSelect && typeof App !== 'undefined' && App.getPromptMode) {
            promptSelect.value = App.getPromptMode();
        }
        updateElapsedDisplay();
        updatePauseControls();
        updateLivesDisplay();
        updateProgressDisplay();
        document.getElementById('game-input').value = '';
        document.getElementById('game-input').focus();
        document.getElementById('feedback-area').textContent = '';
        const answerToolsEl = document.getElementById('answer-tools');
        if (answerToolsEl) answerToolsEl.style.display = 'none';

        // Show/hide timer based on timeLimit
        const timerEl = document.getElementById('game-timer');
        if (state.timeTotal > 0) {
            timerEl.parentElement.style.display = '';
            timerEl.textContent = state.timeLeft;
            timerEl.style.color = '';
        } else {
            timerEl.parentElement.style.display = 'none';
        }

        // Hide lives display (no limit now)
        document.getElementById('game-lives').parentElement.style.display = 'none';

        // Show/hide listening controls
        const promptMode = getPromptModeConfig();
        const isListening = state.mode === 'listening' || promptMode.listeningStyle;
        document.getElementById('listening-controls').style.display = isListening ? 'flex' : 'none';

        // Bind Enter key
        const input = document.getElementById('game-input');
        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitAnswer();
            }
        };
        // Focus the input after the page becomes visible (deferred so display toggles settle)
        setTimeout(() => { try { input.focus(); } catch (_) {} }, 50);
        setTimeout(() => { try { input.focus(); } catch (_) {} }, 400);
    }

    // Show current item
    function showCurrentItem() {
        if (state.currentIndex >= state.items.length) {
            endGame(true);
            return;
        }

        const item = state.items[state.currentIndex];
        const targetEl = document.getElementById('target-text');
        const hintEl = document.getElementById('hint-cn');
        const hintAreaEl = document.getElementById('hint-area');
        const inputEl = document.getElementById('game-input');
        const answerToolsEl = document.getElementById('answer-tools');

        inputEl.value = '';
        inputEl.className = 'game-input';
        inputEl.focus();
        document.getElementById('feedback-area').textContent = '';

        if (state.mode === 'listening') {
            // Hide text, play audio
            hintAreaEl.style.display = '';
            hintAreaEl.hidden = false;
            targetEl.textContent = '🔊 听录音，输入你听到的内容';
            targetEl.style.fontSize = '20px';
            hintEl.textContent = `第 ${state.currentIndex + 1} 题 | ${item.type === 'word' ? '单词' : '短语'}`;
            Audio.setCurrentWord(item.en, 'en-US');
            if (answerToolsEl) answerToolsEl.style.display = 'flex';
            // Auto play after delay (needs prior user interaction for browser policy)
            setTimeout(() => Audio.speak(item.en, false, 'en-US'), 800);
        } else {
            const promptMode = getPromptModeConfig();
            const englishText = item.en || '';
            const chineseText = item.cn || '';
            const targetText = promptMode.listeningStyle
                ? '🔊'
                : (promptMode.showEnglish ? englishText : ((promptMode.targetUsesChinese ? chineseText : '') || englishText));
            targetEl.textContent = targetText;
            targetEl.style.fontSize = promptMode.listeningStyle
                ? '42px'
                : item.type === 'sentence'
                ? (promptMode.showEnglish ? '22px' : '20px')
                : '32px';
            hintEl.textContent = promptMode.showChinese ? chineseText : '';
            const showHint = !!(promptMode.showChinese && chineseText);
            hintAreaEl.style.display = showHint ? '' : 'none';
            hintAreaEl.hidden = !showHint;
            if (!showHint) hintEl.textContent = '';
            const audioText = promptMode.audioText === 'chinese'
                ? (sanitizeChineseSpeechText(chineseText) || chineseText || englishText)
                : englishText;
            if (audioText) {
                Audio.setCurrentWord(audioText, promptMode.audioLang);
            } else {
                Audio.setCurrentWord(englishText, 'en-US');
            }
            if (answerToolsEl) answerToolsEl.style.display = promptMode.answerTools ? 'flex' : 'none';
            if (promptMode.autoSpeak && audioText) Audio.speak(audioText, false, promptMode.audioLang);
            document.getElementById('listening-controls').style.display = promptMode.listeningStyle ? 'flex' : 'none';
        }

        updateProgressDisplay();
    }

    // Build highlighted diff between correct answer and user's input
    function buildDiffHighlight(correct, userAnswer) {
        let html = '<span class="diff-label">正确: </span>';
        const cArr = correct.split('');
        const uArr = userAnswer.split('');
        const maxLen = Math.max(cArr.length, uArr.length);

        for (let i = 0; i < cArr.length; i++) {
            const ch = cArr[i];
            if (i < uArr.length && uArr[i] === ch) {
                html += `<span class="diff-correct">${escapeChar(ch)}</span>`;
            } else if (i < uArr.length) {
                // Wrong character at this position
                html += `<span class="diff-wrong">${escapeChar(ch)}</span>`;
            } else {
                // Missing character (user typed too short)
                html += `<span class="diff-missing">${escapeChar(ch)}</span>`;
            }
        }

        // Show what user typed with highlights
        html += '<br><span class="diff-label">你输入: </span>';
        for (let i = 0; i < uArr.length; i++) {
            const ch = uArr[i];
            if (i < cArr.length && cArr[i] === ch) {
                html += `<span class="diff-correct">${escapeChar(ch)}</span>`;
            } else {
                html += `<span class="diff-wrong">${escapeChar(ch)}</span>`;
            }
        }

        return html;
    }

    function escapeChar(ch) {
        if (ch === ' ') return '&nbsp;';
        if (ch === '<') return '&lt;';
        if (ch === '>') return '&gt;';
        if (ch === '&') return '&amp;';
        return ch;
    }

    // Fetch dictionary entries for the correct word and user input, then render rich feedback panels
    async function renderDictPanels(correctWord, userAnswer, containerId) {
        try {
            const wordsToLookup = [correctWord];
            const userTrimmed = String(userAnswer || '').trim();
            const sameWord = userTrimmed.toLowerCase() === String(correctWord || '').toLowerCase();
            if (userTrimmed && !sameWord) wordsToLookup.push(userTrimmed);

            const r = await fetch('/api/dict/lookup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ words: wordsToLookup })
            });
            const data = r.ok ? await r.json() : { results: {} };
            const container = document.getElementById(containerId);
            if (!container) return;

            const correctEntry = data.results && data.results[correctWord];
            const userEntry = (!sameWord && userTrimmed)
                ? (data.results && data.results[userTrimmed])
                : null;

            let html = '';
            html += renderDictCard('✅ 正确单词', correctWord, correctEntry, false);
            if (userEntry !== null && userTrimmed && !sameWord) {
                html += renderDictCard('✏️ 你输入的', userTrimmed, userEntry, true);
            }
            container.innerHTML = html;

            // Async fetch example sentences for the correct word (and user's word if real)
            const exWords = [correctWord];
            if (userEntry && userEntry.found && !sameWord) exWords.push(userTrimmed);
            try {
                const er = await fetch('/api/dict/examples', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ words: exWords })
                });
                if (er.ok) {
                    const ed = await er.json();
                    const stillThere = document.getElementById(containerId);
                    if (!stillThere) return;
                    // Inject example list under each card
                    for (const w of exWords) {
                        const exs = (ed.results && ed.results[w]) || [];
                        const cardEl = stillThere.querySelector(`[data-dict-word="${cssEscape(w)}"]`);
                        if (!cardEl) continue;
                        const exHtml = exs.length
                            ? '<div class="dict-examples"><div class="dict-examples-label">📚 例句</div>' +
                              exs.map(e => {
                                  const safeEn = (e.en || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                                  return `<div class="dict-example"><div class="dict-ex-en">${escapeHtml(e.en)} <button class="dict-ex-speak" title="朗读" onclick="Audio.speak('${safeEn}')">🔊</button></div><div class="dict-ex-cn">${escapeHtml(e.cn)}</div></div>`;
                              }).join('') +
                              '</div>'
                            : '<div class="dict-examples"><div class="dict-examples-label">📚 例句</div><div class="dict-empty-small">暂无例句</div></div>';
                        cardEl.insertAdjacentHTML('beforeend', exHtml);
                    }
                }
            } catch (_) {}
        } catch (err) {
            const container = document.getElementById(containerId);
            if (container) container.innerHTML = '<div class="dict-error">词典查询失败</div>';
        }
    }

    function renderDictCard(label, word, entry, isUser) {
        const safeWord = String(word || '').replace(/</g, '&lt;');
        const dataAttr = `data-dict-word="${(word || '').replace(/"/g, '&quot;')}"`;
        if (!entry || !entry.found) {
            return `<div class="dict-card ${isUser ? 'dict-card-user' : 'dict-card-correct'}" ${dataAttr}>
                <div class="dict-label">${label}</div>
                <div class="dict-word">${safeWord}</div>
                <div class="dict-empty">❓ 词典中查无此单词</div>
            </div>`;
        }
        const ph = entry.phonetic ? `<span class="dict-phonetic">/${entry.phonetic}/</span>` : '';
        const tr = entry.translation ? `<div class="dict-tr">${escapeHtml(entry.translation)}</div>` : '';
        const def = entry.definition ? `<div class="dict-def">📘 ${escapeHtml(entry.definition)}</div>` : '';
        const exch = entry.exchange ? renderExchange(entry.exchange) : '';
        const speakBtn = `<button class="dict-speak" title="朗读" onclick="Audio.speak('${entry.word.replace(/'/g, "\\'")}')">🔊</button>`;
        return `<div class="dict-card ${isUser ? 'dict-card-user' : 'dict-card-correct'}" ${dataAttr}>
            <div class="dict-label">${label}</div>
            <div class="dict-word-row"><span class="dict-word">${escapeHtml(entry.word || word)}</span> ${ph} ${speakBtn}</div>
            ${tr}
            ${def}
            ${exch}
        </div>`;
    }

    function cssEscape(s) {
        return String(s || '').replace(/["\\]/g, '\\$&');
    }

    function renderExchange(ex) {
        if (!ex) return '';
        const labels = { p: '过去式', d: '过去分词', i: '现在分词', '3': '第三人称单数', s: '复数', r: '比较级', t: '最高级', '0': '原形' };
        const parts = [];
        for (const k of Object.keys(labels)) {
            if (ex[k]) parts.push(`<span class="dict-exch"><em>${labels[k]}</em>: ${escapeHtml(ex[k])}</span>`);
        }
        return parts.length ? `<div class="dict-exchange">${parts.join(' · ')}</div>` : '';
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // Submit answer
    function submitAnswer() {
        if (state.isPaused) return;
        if (state.currentIndex >= state.items.length) return;

        const input = document.getElementById('game-input');
        const answer = input.value.trim();
        if (!answer) return;

        const item = state.items[state.currentIndex];
        const correct = answer.toLowerCase() === item.en.toLowerCase();

        const feedbackEl = document.getElementById('feedback-area');
        const inputEl = document.getElementById('game-input');

        if (correct) {
            // Correct answer
            state.correct++;
            state.combo++;
            if (state.combo > state.maxCombo) state.maxCombo = state.combo;

            // Calculate score
            let points = 10;
            if (item.type === 'phrase') points = 20;
            if (item.type === 'sentence') points = 30;
            points += Math.min(state.combo * 2, 20); // Combo bonus

            state.score += points;
            state.coinsEarned += Math.floor(points / 5);

            // UI feedback
            inputEl.className = 'game-input correct';
            feedbackEl.className = 'feedback-area feedback-correct';
            feedbackEl.textContent = getCorrectMessage();
            Audio.playCorrect();
            if (state.combo > 0 && state.combo % 5 === 0) Audio.playCombo();

            // Remove from wrong answers if was there
            Storage.removeWrongAnswer(item.en);

            // Report to SRS (only if first attempt — i.e. not already reported as wrong)
            if (_srsReportedForIndex !== state.currentIndex) {
                reportSrs(item, true, answer);
            }

            // Update WPM
            updateWPM();

            // Update UI
            document.getElementById('game-score').textContent = state.score;
            document.getElementById('game-combo').textContent = state.combo;
            const accuracy = state.correct + state.wrong > 0
                ? Math.round((state.correct / (state.correct + state.wrong)) * 100) : 100;
            document.getElementById('game-accuracy').textContent = accuracy + '%';

            // Next item after delay
            state.currentIndex++;
            updateProgressDisplay();
            setTimeout(() => showCurrentItem(), 1000);
        } else {
            // Wrong answer - allow retry (don't advance)
            state.wrong++;
            state.combo = 0;

            // UI feedback - highlight differences
            inputEl.className = 'game-input wrong';
            feedbackEl.className = 'feedback-area feedback-wrong';
            feedbackEl.innerHTML = `❌ 再试一次！<br>${buildDiffHighlight(item.en, answer)}<div class="dict-panels" id="dict-panels-${state.currentIndex}"><div class="dict-loading">📖 正在查询词典…</div></div>`;
            Audio.playWrong();

            // Async fetch rich dictionary info for both correct and user's input
            renderDictPanels(item.en, answer, `dict-panels-${state.currentIndex}`);

            // Save wrong answer for review
            Storage.addWrongAnswer({
                en: item.en,
                cn: item.cn,
                yourAnswer: answer,
                type: item.type
            });
            recordSessionWrongAnswer(item, answer);

            // Report to SRS once per item (first wrong attempt)
            if (_srsReportedForIndex !== state.currentIndex) {
                reportSrs(item, false, answer);
                _srsReportedForIndex = state.currentIndex;
            }

            // Update combo & accuracy display
            document.getElementById('game-combo').textContent = state.combo;
            const accuracy = state.correct + state.wrong > 0
                ? Math.round((state.correct / (state.correct + state.wrong)) * 100) : 100;
            document.getElementById('game-accuracy').textContent = accuracy + '%';

            // Clear input for retry after short delay
            setTimeout(() => {
                inputEl.value = '';
                inputEl.className = 'game-input';
                inputEl.focus();
            }, 1500);
        }
    }

    // Update WPM (words per minute)
    function updateWPM() {
        const elapsed = getElapsedMs() / 1000 / 60; // minutes
        if (elapsed > 0) {
            const wpm = Math.round(state.correct / elapsed);
            document.getElementById('game-wpm').textContent = wpm;
        }
    }

    // Correct answer messages
    function getCorrectMessage() {
        const msgs = [
            '✅ 正确！Correct!', '🎉 太棒了！Excellent!', '👍 做得好！Good job!',
            '⭐ 完美！Perfect!', '🔥 厉害！Amazing!', '💯 满分！Full marks!'
        ];
        if (state.combo >= 5) return `🔥 ${state.combo}连击！${state.combo}x Combo!`;
        return msgs[Math.floor(Math.random() * msgs.length)];
    }

    // Timer - only starts if timeLimit > 0
    function startTimer() {
        if (state.timer) clearInterval(state.timer);
        updateElapsedDisplay();
        state.timer = setInterval(() => {
            if (state.isPaused) return;
            updateElapsedDisplay();
            if (state.timeTotal > 0) {
                state.timeLeft--;
                document.getElementById('game-timer').textContent = state.timeLeft;

                if (state.timeLeft <= 10) {
                    document.getElementById('game-timer').style.color = 'var(--danger)';
                }

                if (state.timeLeft <= 0) {
                    endGame(false);
                }
            }
        }, 1000);
    }

    // Update lives display
    function updateLivesDisplay() {
        const hearts = '❤️'.repeat(state.lives) + '🖤'.repeat(state.maxLives - state.lives);
        document.getElementById('game-lives').textContent = hearts;
    }

    // Update progress display
    function updateProgressDisplay() {
        const progress = state.totalItems > 0 ? (state.currentIndex / state.totalItems) * 100 : 0;
        document.getElementById('game-progress-fill').style.width = progress + '%';
        document.getElementById('game-progress-text').textContent =
            `${state.currentIndex}/${state.totalItems}`;
    }

    function refreshPrompt() {
        if (!state.items || state.items.length === 0) return;
        if (state.currentIndex >= state.items.length) return;
        showCurrentItem();
        updatePauseControls();
    }

    function showAnswerExplanation() {
        if (!state.items || state.currentIndex >= state.items.length) return;
        renderAnswerExplanation(state.items[state.currentIndex]);
    }

    async function reportCurrentIssue() {
        if (!state.items || state.currentIndex >= state.items.length) return;
        if (typeof AuthUI === 'undefined' || !AuthUI.isLoggedIn || !AuthUI.isLoggedIn()) {
            alert('请先登录后再报错 Please login first');
            return;
        }
        const item = state.items[state.currentIndex];
        const note = prompt('请简要说明问题（可留空）\nDescribe the issue (optional):', '');
        if (note === null) return;
        const answerInput = document.getElementById('game-input');
        const sourceKind = item._sourceKind
            || (state.grade ? `grade${state.grade}` : (state.isLevelMode ? 'level' : (state.currentModule ? 'module' : 'custom')));
        const sourceRef = item._sourceField
            || (state.currentModule ? `module:${state.currentModule}` : (state.level ? `level:${state.level}` : ''));
        try {
            const res = await AuthUI.apiRequest('/me/vocab-reports', {
                method: 'POST',
                body: JSON.stringify({
                    en_text: item.en || '',
                    cn_text: item.cn || '',
                    user_answer: answerInput ? answerInput.value.trim() : '',
                    item_type: item.type || 'word',
                    prompt_mode: (typeof App !== 'undefined' && App.getPromptMode) ? App.getPromptMode() : '',
                    source_kind: sourceKind,
                    source_unit_id: item._sourceUnitId || null,
                    source_unit_name: item._sourceUnitName || '',
                    source_ref: sourceRef,
                    note: String(note || '').trim()
                })
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || '上报失败 Report failed');
                return;
            }
            alert(data.message || '已上报，谢谢反馈');
        } catch (e) {
            alert('上报失败 Report failed');
        }
    }

    // End game
    function endGame(completed) {
        if (state.timer) {
            clearInterval(state.timer);
            state.timer = null;
        }

        const accuracy = state.correct + state.wrong > 0
            ? Math.round((state.correct / (state.correct + state.wrong)) * 100) : 0;

        const durationMs = getElapsedMs();
        const timeUsed = Math.max(1, durationMs / 1000);
        const wpm = Math.round((state.correct * 60) / timeUsed);

        // Calculate stars (1-3)
        let stars = 0;
        if (completed && accuracy >= 90) stars = 3;
        else if (completed && accuracy >= 70) stars = 2;
        else if (completed && accuracy >= 50) stars = 1;
        else if (!completed && accuracy >= 60) stars = 1;

        // Bonus coins
        state.coinsEarned += stars * 5;

        // Save progress
        const storageData = Storage.getData();
        Storage.update({
            totalCorrect: storageData.totalCorrect + state.correct,
            totalAttempts: storageData.totalAttempts + state.correct + state.wrong,
            totalWordsTyped: storageData.totalWordsTyped + state.correct,
            gamesPlayed: storageData.gamesPlayed + 1,
            maxCombo: Math.max(storageData.maxCombo, state.maxCombo),
            totalTimeMs: (storageData.totalTimeMs || 0) + durationMs
        });

        if (state.coinsEarned > 0) Storage.addCoins(state.coinsEarned);
        if (stars > 0) Storage.addStars(stars);

        if (state.isLevelMode && stars > 0 && !state.grade) {
            Storage.saveLevelResult(state.level, state.score, stars);
        }
        // Phase 2: per-grade unlock & stars (separate from legacy levelStars)
        if (state.isLevelMode && state.grade && stars > 0) {
            try {
                const gKey = 'g' + state.grade;
                const unlockKey = 'gradeLevelsUnlocked_' + gKey;
                const starsKey = 'gradeLevelStars_' + gKey;
                const cur = parseInt(localStorage.getItem(unlockKey), 10) || 1;
                if (state.level + 1 > cur && state.level < 5) {
                    localStorage.setItem(unlockKey, String(state.level + 1));
                }
                let sm = {};
                try { sm = JSON.parse(localStorage.getItem(starsKey) || '{}'); } catch (e) {}
                sm[state.level] = Math.max(sm[state.level] || 0, stars);
                localStorage.setItem(starsKey, JSON.stringify(sm));
            } catch (e) { /* ignore */ }
        }

        // Add to leaderboard
        if (state.score > 0) {
            Storage.addLeaderboardEntry(storageData.playerName, state.score, {
                durationMs,
                accuracy
            });
        }

        // Report practice session to server (if logged in)
        try {
            const refId = state.isLevelMode ? state.level : (state.currentModule || 0);
            const kind = state.grade
                ? (state.isLevelMode ? `grade${state.grade}-level` : `grade${state.grade}-random`)
                : (state.isLevelMode ? 'level' : 'module');
            Storage.reportPractice({
                kind,
                ref_id: String(refId == null ? '' : refId),
                session_title: buildSessionTitle(),
                score: state.score,
                stars: stars,
                correct: state.correct,
                attempts: state.correct + state.wrong,
                duration_ms: durationMs,
                wrong_items: (state.sessionWrongAnswers || []).map(item => ({
                    en: item.en || '',
                    cn: item.cn || '',
                    yourAnswer: item.yourAnswer || '',
                    type: item.type || 'word'
                }))
            });
        } catch (e) { /* ignore */ }

        // Check badges
        const newBadges = checkBadges();

        // Show results
        showResults(completed, stars, accuracy, wpm, durationMs, newBadges);
    }

    // Check and award badges
    function checkBadges() {
        const data = Storage.getData();
        const newBadges = [];

        // Spelling Master - 50 correct words total
        if (data.totalCorrect >= 50 && Storage.earnBadge('spelling_master')) {
            newBadges.push({ id: 'spelling_master', name: '拼写大师 Spelling Master', icon: '📝' });
        }

        // Speed Star - max combo >= 10
        if (data.maxCombo >= 10 && Storage.earnBadge('speed_star')) {
            newBadges.push({ id: 'speed_star', name: '速度之星 Speed Star', icon: '⚡' });
        }

        // Listening Hero - complete level 4 or 8
        if (data.levelStars['4'] && Storage.earnBadge('listening_hero')) {
            newBadges.push({ id: 'listening_hero', name: '听力英雄 Listening Hero', icon: '🎧' });
        }

        // First Steps - complete first level
        if (data.levelStars['1'] && Storage.earnBadge('first_steps')) {
            newBadges.push({ id: 'first_steps', name: '初次闯关 First Steps', icon: '👶' });
        }

        // Streak Master - 7 day streak
        if (data.streak >= 7 && Storage.earnBadge('streak_master')) {
            newBadges.push({ id: 'streak_master', name: '坚持大师 Streak Master', icon: '🔥' });
        }

        // Coin Collector - 100 coins
        if (data.coins >= 100 && Storage.earnBadge('coin_collector')) {
            newBadges.push({ id: 'coin_collector', name: '金币收藏家 Coin Collector', icon: '🪙' });
        }

        // Perfect Score - 100% accuracy in a game
        if (state.correct > 0 && state.wrong === 0 && Storage.earnBadge('perfectionist')) {
            newBadges.push({ id: 'perfectionist', name: '完美主义者 Perfectionist', icon: '💎' });
        }

        // Star Collector - 30 stars total
        if (data.stars >= 30 && Storage.earnBadge('star_collector')) {
            newBadges.push({ id: 'star_collector', name: '星星收集者 Star Collector', icon: '🌟' });
        }

        // Champion - complete all 10 levels
        const allComplete = [1,2,3,4,5,6,7,8,9,10].every(l => data.levelStars[l.toString()]);
        if (allComplete && Storage.earnBadge('champion')) {
            newBadges.push({ id: 'champion', name: '全关卡冠军 Champion', icon: '👑' });
        }

        // Module Champion - complete practice in 5 different modules
        if (data.gamesPlayed >= 10 && Storage.earnBadge('module_champion')) {
            newBadges.push({ id: 'module_champion', name: '模块冠军 Module Champion', icon: '🏆' });
        }

        if (newBadges.length > 0) Audio.playAchievement();
        return newBadges;
    }

    // Show results page
    function showResults(completed, stars, accuracy, wpm, durationMs, newBadges) {
        App.showPage('page-results');

        // Title
        const titleEl = document.getElementById('results-title');
        if (completed && stars >= 2) {
            titleEl.textContent = '🎉 太棒了！Excellent!';
            showCelebration('🎉', '太棒了！Excellent!');
        } else if (completed) {
            titleEl.textContent = '✅ 过关了！Level Passed!';
        } else {
            titleEl.textContent = '😢 再试一次 Try Again!';
        }

        // Stars
        const starsEl = document.getElementById('results-stars');
        starsEl.textContent = '⭐'.repeat(stars) + '☆'.repeat(3 - stars);

        // Stats
        document.getElementById('result-score').textContent = state.score;
        document.getElementById('result-accuracy').textContent = accuracy + '%';
        document.getElementById('result-speed').textContent = wpm + ' WPM';
        document.getElementById('result-elapsed').textContent = formatElapsedMs(durationMs);
        document.getElementById('result-combo').textContent = state.maxCombo;
        document.getElementById('result-coins').textContent = '+' + state.coinsEarned;

        // Achievements
        const achEl = document.getElementById('results-achievements');
        achEl.innerHTML = '';
        newBadges.forEach(badge => {
            achEl.innerHTML += `<div class="achievement-popup">
                🏅 新成就！New Badge: ${badge.icon} ${badge.name}
            </div>`;
        });

        // Next level button
        const nextBtn = document.getElementById('btn-next-level');
        if (state.isLevelMode && stars > 0 && state.level < LEVELS.length) {
            nextBtn.style.display = 'inline-flex';
        } else {
            nextBtn.style.display = 'none';
        }

        Audio.playLevelComplete();
    }

    // Celebration overlay
    function showCelebration(emoji, text) {
        const el = document.getElementById('celebration');
        document.getElementById('celebration-emoji').textContent = emoji;
        document.getElementById('celebration-text').textContent = text;
        el.style.display = 'flex';
        setTimeout(() => { el.style.display = 'none'; }, 2500);
    }

    // Next level
    function nextLevel() {
        if (state.grade) {
            if (state.level < GRADE_LEVELS.length) {
                startGradeLevel(state.grade, state.level + 1);
            }
            return;
        }
        if (state.level < LEVELS.length) {
            startLevel(state.level + 1);
        }
    }

    // Retry current level
    function retryLevel() {
        if (state.grade && state.isLevelMode) {
            startGradeLevel(state.grade, state.level);
        } else if (state.grade) {
            startGradeRandom(state.grade, state.totalItems);
        } else if (state.isLevelMode) {
            startLevel(state.level);
        } else {
            startModulePractice(state.mode);
        }
    }

    // Pause / Resume
    function pauseGame() {
        if (state.isPaused) return;
        state.isPaused = true;
        state.pauseStartedAt = Date.now();
        updatePauseControls();
        document.getElementById('feedback-area').textContent = '⏸️ 已暂停，点击继续后恢复计时并继续作答';
    }

    function resumeGame() {
        if (!state.isPaused) return;
        if (state.pauseStartedAt) {
            state.pausedDurationMs += Date.now() - state.pauseStartedAt;
            state.pauseStartedAt = null;
        }
        state.isPaused = false;
        updatePauseControls();
        updateElapsedDisplay();
        document.getElementById('feedback-area').textContent = '';
        document.getElementById('game-input').focus();
    }

    // Quit game
    function quitGame() {
        if (state.timer) {
            clearInterval(state.timer);
            state.timer = null;
        }
        state.isPaused = false;
        state.pauseStartedAt = null;
        updatePauseControls();
        document.getElementById('modal-pause').style.display = 'none';
        App.showPage('page-home');
    }

    // Set current module for practice
    function setCurrentModule(moduleId) {
        state.currentModule = moduleId;
    }

    // Expose level definitions
    function getLevels() { return LEVELS; }

    // ====== Phase 2: Grade-based difficulty modes ======
    // 5 dynamic levels per grade. Each fetches random words from /api/practice/random.
    const GRADE_LEVELS = [
        { id: 1, count: 10, passScore: 60, name: '入门', desc: '10 个单词热身' },
        { id: 2, count: 15, passScore: 65, name: '进阶', desc: '15 个单词巩固' },
        { id: 3, count: 20, passScore: 70, name: '熟练', desc: '20 个单词冲刺' },
        { id: 4, count: 25, passScore: 75, name: '挑战', desc: '25 个单词挑战' },
        { id: 5, count: 30, passScore: 80, name: '终极', desc: '30 个单词大考' }
    ];
    function getGradeLevels() { return GRADE_LEVELS; }

    async function fetchRandomWords(grade, count) {
        try {
            const r = await fetch(`/api/practice/random?level=${grade}&count=${count}`);
            if (!r.ok) throw new Error('fetch failed: ' + r.status);
            const data = await r.json();
            return data.items || [];
        } catch (e) {
            console.error('[fetchRandomWords]', e);
            alert('词库加载失败，请稍后再试');
            return [];
        }
    }

    function buildState(items, opts) {
        return {
            mode: opts.mode || 'words',
            level: opts.level || 0,
            items: items,
            currentIndex: 0,
            score: 0,
            combo: 0,
            maxCombo: 0,
            lives: opts.lives || 99,
            maxLives: opts.lives || 99,
            correct: 0,
            wrong: 0,
            totalItems: items.length,
            timer: null,
            timeLeft: opts.timeLimit || 0,
            timeTotal: opts.timeLimit || 0,
            startTime: Date.now(),
            pausedDurationMs: 0,
            pauseStartedAt: null,
            isPaused: false,
            isLevelMode: !!opts.isLevelMode,
            currentModule: opts.currentModule || null,
            coinsEarned: 0,
            grade: opts.grade || null,
            sessionTitle: opts.sessionTitle || '',
            sessionWrongAnswers: []
        };
    }

    // Start a grade-based level (闯关模式)
    async function startGradeLevel(grade, levelId) {
        const def = GRADE_LEVELS.find(l => l.id === levelId);
        if (!def) return;
        const items = await fetchRandomWords(grade, def.count);
        if (items.length === 0) return;
        state = buildState(items, {
            mode: 'words', level: levelId, lives: 99, isLevelMode: true, grade,
            sessionTitle: `${getGradeLabel(grade)} · ${(def && def.name) || ('Level ' + levelId)}`
        });
        initGameUI();
        startTimer();
        showCurrentItem();
    }

    // Start grade-based module practice (模块练习)
    async function startGradeRandom(grade, count) {
        const items = await fetchRandomWords(grade, count || 15);
        if (items.length === 0) return;
        state = buildState(items, {
            mode: 'words', level: 0, lives: 99, isLevelMode: false, grade,
            sessionTitle: `${getGradeLabel(grade)} · ${items.length}词练习`
        });
        initGameUI();
        startTimer();
        showCurrentItem();
    }

    return {
        startLevel,
        startModulePractice,
        startCustomPractice,
        startGradeLevel,
        startGradeRandom,
        startDictation,
        submitAnswer,
        nextLevel,
        retryLevel,
        pauseGame,
        resumeGame,
        quitGame,
        refreshPrompt,
        showAnswerExplanation,
        reportCurrentIssue,
        setCurrentModule,
        getLevels,
        getGradeLevels,
        loadModuleData
    };
})();
