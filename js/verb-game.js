// verb-game.js — Mini quiz for verb past tense / past participle.
// Pulls the unit's words, looks up their stardict "exchange" forms via
// /api/dict/lookup, keeps only entries that look like verbs, and asks the user
// to type the requested form. Provides a "show answer & explanation" button.
(function () {
    'use strict';

    const MODAL_ID = 'modal-verb-game';
    const BATCH_SIZE = 40;

    const state = {
        unit: null,
        session: null,   // { kind, refId, title }
        questions: [],   // {base, cn, want: 'past'|'pp', answers: [str], all: {past, pp, base, ing, third}}
        index: 0,
        score: 0,
        attempts: 0,
        wrongItems: [],  // { en, cn, yourAnswer, type:'word' }
        startedAt: 0,
        reported: false,
        revealed: false,
        finished: false
    };

    function $(id) { return document.getElementById(id); }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function splitForms(raw) {
        if (!raw) return [];
        return String(raw).split(/[\/,，;；|]/)
            .map(s => s.trim().toLowerCase())
            .filter(Boolean);
    }

    // Heuristic: detect regular -ed inflection.
    function classifyRegular(base, past) {
        if (!base || !past) return false;
        const b = base.toLowerCase(); const p = past.toLowerCase();
        if (p === b + 'ed') return true;
        if (b.endsWith('e') && p === b + 'd') return true;
        if (b.endsWith('y') && !/[aeiou]y$/.test(b) && p === b.slice(0, -1) + 'ied') return true;
        // doubled final consonant (e.g. stop → stopped)
        if (b.length >= 2 && /[bcdfghjklmnpqrstvwxz]$/.test(b)
            && p === b + b.slice(-1) + 'ed') return true;
        return false;
    }

    function extractPosList(text) {
        if (!text) return [];
        const out = [];
        const seen = new Set();
        const re = /(^|[\s;；,，/(\[【])\s*(n|v|vt|vi|aux|adj|adv|prep|conj|pron|art|num|int|interj)\.\s*/gi;
        let m;
        while ((m = re.exec(text)) !== null) {
            let p = m[2].toLowerCase();
            if (p === 'vt' || p === 'vi' || p === 'aux') p = 'v';
            if (p === 'interj') p = 'int';
            if (!seen.has(p)) { out.push(p); seen.add(p); }
        }
        return out;
    }

    // Decide whether a word should be treated as a verb for the quiz.
    // Priority: teacher-provided Chinese marker > dictionary translation marker.
    // Only when neither carries a POS tag do we fall back to "has verb forms".
    function looksLikeVerb(en, info, userCn) {
        if (!info || !info.exchange) return false;
        const ex = info.exchange;
        const lower = String(en || '').trim().toLowerCase();
        if (!lower || /\s/.test(lower)) return false;
        if (!ex.p && !ex.q) return false;
        const past = String(ex.p || '').toLowerCase();
        const pp = String(ex.q || '').toLowerCase();
        if (past === lower && pp === lower && lower.length <= 2) return false;

        const cnPos = extractPosList(userCn);
        if (cnPos.length) return cnPos[0] === 'v';
        const tPos = extractPosList(info.translation);
        if (tPos.length) return tPos[0] === 'v';
        return true;
    }

    function buildQuestion(base, cn, info) {
        const ex = info.exchange || {};
        const past = ex.p ? splitForms(ex.p) : [];
        const pp = ex.q ? splitForms(ex.q) : [];
        const options = [];
        if (past.length) options.push('past');
        if (pp.length) options.push('pp');
        if (!options.length) return null;
        const want = options[Math.floor(Math.random() * options.length)];
        return {
            base: String(base).toLowerCase(),
            cn: cn || '',
            want,
            answers: want === 'past' ? past : pp,
            all: { base: base.toLowerCase(), past, pp, ing: ex.i || '', third: ex['3'] || '' }
        };
    }

    function ensureModal() {
        let modal = $(MODAL_ID);
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = MODAL_ID;
        modal.className = 'modal';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:560px;">
                <h3 id="vg-title">🎯 动词时态游戏 Verb Tense Quiz</h3>
                <div id="vg-meta" style="color:var(--text-light);font-size:13px;margin:4px 0 10px;"></div>
                <div id="vg-body">
                    <p class="empty-hint">加载中... Loading...</p>
                </div>
                <div class="modal-actions" id="vg-actions" style="flex-wrap:wrap;gap:8px;">
                    <button class="btn btn-outline" id="vg-show-answer" style="display:none;">💡 显示答案和解释 Show Answer</button>
                    <button class="btn btn-outline" id="vg-skip" style="display:none;">⏭️ 跳过 Skip</button>
                    <button class="btn btn-primary" id="vg-submit" style="display:none;">确认 Submit</button>
                    <button class="btn btn-primary" id="vg-next" style="display:none;">下一题 Next ▶</button>
                    <button class="btn btn-outline" id="vg-close">关闭 Close</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        $('vg-close').onclick = close;
        $('vg-submit').onclick = submit;
        $('vg-next').onclick = next;
        $('vg-show-answer').onclick = reveal;
        $('vg-skip').onclick = () => { reveal(); };
        return modal;
    }

    function open() { ensureModal().style.display = 'flex'; }
    function close() {
        // Report progress to practice history (even if user closed mid-quiz)
        try { reportPracticeLog(); } catch (_) {}
        const modal = $(MODAL_ID);
        if (modal) modal.style.display = 'none';
        state.unit = null; state.session = null;
        state.questions = []; state.index = 0;
        state.score = 0; state.attempts = 0; state.wrongItems = [];
        state.startedAt = 0; state.reported = false;
        state.revealed = false; state.finished = false;
    }

    // ----- Practice / SRS reporting -----

    function reportPracticeLog() {
        if (state.reported) return;
        if (!state.questions || state.questions.length === 0) return;
        if (state.attempts === 0 && state.wrongItems.length === 0) return;
        state.reported = true;
        const total = state.questions.length;
        const correct = state.score;
        const attempts = state.attempts || correct + state.wrongItems.length;
        const durationMs = state.startedAt ? Date.now() - state.startedAt : 0;
        const score = total ? Math.round(correct * 100 / total) : 0;
        const session = state.session || {};
        const title = session.title
            || `动词时态 · ${(state.unit && state.unit.name) || ''}`.trim();
        const payload = {
            kind: session.kind || 'verb-tense',
            ref_id: String(session.refId == null ? '' : session.refId),
            session_title: title,
            score, stars: 0,
            correct, attempts,
            duration_ms: durationMs,
            wrong_items: state.wrongItems.slice(0, 200)
        };
        try {
            if (typeof Storage !== 'undefined' && Storage.reportPractice) {
                Storage.reportPractice(payload);
            }
        } catch (_) {}
    }

    function reportSrsForVerb(q, userInput, isCorrect) {
        try {
            if (typeof AuthUI === 'undefined' || !AuthUI.isLoggedIn || !AuthUI.isLoggedIn()) return;
            const headers = { 'Content-Type': 'application/json' };
            const tok = (AuthUI.getToken && AuthUI.getToken()) || localStorage.getItem('auth_token');
            if (tok) headers['Authorization'] = 'Bearer ' + tok;
            fetch('/api/srs/answer', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    en: q.base,
                    cn: q.cn || '',
                    correct: !!isCorrect,
                    input: typeof userInput === 'string' ? userInput.slice(0, 200) : ''
                })
            }).catch(() => {});
        } catch (_) {}
    }

    async function start(unitId) {
        const unit = (typeof App !== 'undefined' && App.findMaterialUnit)
            ? App.findMaterialUnit(unitId)
            : null;
        if (!unit) { alert('找不到该单元 Unit not found'); return; }
        return startWithUnit(unit, {
            kind: 'verb-tense-material',
            refId: unit.id,
            title: `老师标准 ${unit.name || ''} · 动词时态`
        });
    }

    async function startWithUnit(unit, opts) {
        const options = opts || {};
        const words = (unit.words || []).filter(w => w && w.en && !/\s/.test(w.en.trim()));
        if (!words.length) { alert('该单元没有可用单词 No words available'); return; }
        state.unit = unit;
        state.session = {
            kind: options.kind || 'verb-tense',
            refId: options.refId == null ? '' : options.refId,
            title: options.title || `动词时态 · ${unit.name || ''}`
        };
        state.questions = [];
        state.index = 0;
        state.score = 0;
        state.attempts = 0;
        state.wrongItems = [];
        state.startedAt = Date.now();
        state.reported = false;
        state.revealed = false;
        state.finished = false;
        open();
        const titleEl = $('vg-title');
        if (titleEl) titleEl.textContent = `🎯 动词时态游戏 · ${unit.name || ''}`;
        $('vg-meta').textContent = `共 ${words.length} 个单词，正在筛选动词...  Looking up verb forms...`;
        $('vg-body').innerHTML = '<p class="empty-hint">加载中... Loading...</p>';
        $('vg-show-answer').style.display = 'none';
        $('vg-skip').style.display = 'none';
        $('vg-submit').style.display = 'none';
        $('vg-next').style.display = 'none';

        // Batch lookup. Endpoint accepts up to 50 per call.
        const enList = words.map(w => w.en.trim());
        const cnMap = {};
        words.forEach(w => { cnMap[w.en.trim().toLowerCase()] = w.cn || ''; });
        const lookups = {};
        try {
            for (let i = 0; i < enList.length; i += BATCH_SIZE) {
                const chunk = enList.slice(i, i + BATCH_SIZE);
                const res = await AuthUI.apiRequest('/dict/lookup', {
                    method: 'POST',
                    body: JSON.stringify({ words: chunk })
                });
                const data = await res.json();
                Object.assign(lookups, data.results || {});
            }
        } catch (e) {
            $('vg-body').innerHTML = '<p class="empty-hint">词典加载失败，请稍后再试 Dict lookup failed</p>';
            return;
        }

        const qs = [];
        for (const en of enList) {
            const info = lookups[en];
            if (!info || !info.found) continue;
            if (!looksLikeVerb(en, info, cnMap[en.toLowerCase()])) continue;
            const q = buildQuestion(en, cnMap[en.toLowerCase()], info);
            if (q) qs.push(q);
        }
        // Shuffle
        for (let i = qs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [qs[i], qs[j]] = [qs[j], qs[i]];
        }
        state.questions = qs;
        if (!qs.length) {
            $('vg-meta').textContent = '';
            $('vg-body').innerHTML = '<p class="empty-hint">该单元里没有找到合适的动词 No verbs detected in this unit.</p>';
            return;
        }
        renderQuestion();
    }

    function renderQuestion() {
        const q = state.questions[state.index];
        if (!q) { renderFinish(); return; }
        state.revealed = false;
        const wantLabel = q.want === 'past' ? '过去式 Past Tense' : '过去分词 Past Participle';
        const total = state.questions.length;
        $('vg-meta').textContent = `第 ${state.index + 1} / ${total} 题 · 得分 ${state.score}`;
        $('vg-body').innerHTML = `
            <div style="text-align:center;margin:14px 0 18px;">
                <div style="font-size:14px;color:var(--text-light);margin-bottom:4px;">请写出下面动词的<strong>${escapeHtml(wantLabel)}</strong></div>
                <div style="font-size:30px;font-weight:700;letter-spacing:1px;">${escapeHtml(q.base)}</div>
                ${q.cn ? `<div style="color:var(--text-light);margin-top:4px;">${escapeHtml(q.cn)}</div>` : ''}
            </div>
            <input id="vg-input" type="text" placeholder="在这里输入答案 Type the form..."
                   autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
                   style="width:100%;padding:12px;font-size:18px;border:2px solid #ddd;border-radius:8px;">
            <div id="vg-feedback" style="min-height:24px;margin-top:10px;font-size:14px;"></div>
        `;
        $('vg-show-answer').style.display = '';
        $('vg-skip').style.display = '';
        $('vg-submit').style.display = '';
        $('vg-next').style.display = 'none';
        const input = $('vg-input');
        input.focus();
        input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
    }

    function recordWrong(q, userInput) {
        const wantLabel = q.want === 'past' ? '过去式' : '过去分词';
        const expected = (q.answers && q.answers[0]) || '';
        state.wrongItems.push({
            en: q.base,
            cn: `${wantLabel}: ${expected}${q.cn ? ' · ' + q.cn : ''}`,
            yourAnswer: userInput || '',
            type: 'word'
        });
    }

    function submit() {
        if (state.revealed) { next(); return; }
        const q = state.questions[state.index]; if (!q) return;
        const val = ($('vg-input').value || '').trim().toLowerCase();
        if (!val) { $('vg-input').focus(); return; }
        state.attempts += 1;
        const ok = q.answers.includes(val);
        const fb = $('vg-feedback');
        if (ok) {
            state.score += 1;
            reportSrsForVerb(q, val, true);
            fb.innerHTML = `<span style="color:#059669;">✅ 正确！Correct.</span> ` + answerHtml(q);
            advanceUI(true);
        } else {
            recordWrong(q, val);
            reportSrsForVerb(q, val, false);
            fb.innerHTML = `<span style="color:#dc2626;">❌ 不对。</span> ` + answerHtml(q);
            advanceUI(false);
        }
    }

    function reveal() {
        if (state.revealed) return;
        const q = state.questions[state.index]; if (!q) return;
        // Treat reveal/skip as a wrong attempt (records to wrongbook + SRS)
        const input = $('vg-input');
        const userInput = (input && (input.value || '').trim()) || '';
        state.attempts += 1;
        recordWrong(q, userInput);
        reportSrsForVerb(q, userInput, false);
        $('vg-feedback').innerHTML = `<span style="color:#6366f1;">💡 答案：</span>` + answerHtml(q);
        advanceUI(false);
    }

    function advanceUI(_correct) {
        state.revealed = true;
        $('vg-meta').textContent = `第 ${state.index + 1} / ${state.questions.length} 题 · 得分 ${state.score}`;
        $('vg-submit').style.display = 'none';
        $('vg-show-answer').style.display = 'none';
        $('vg-skip').style.display = 'none';
        $('vg-next').style.display = '';
        const input = $('vg-input');
        if (input) {
            input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); next(); } };
            input.focus();
        }
        $('vg-next').focus();
    }

    function answerHtml(q) {
        const base = q.all.base;
        const past = q.all.past.length ? q.all.past.join(' / ') : '—';
        const pp = q.all.pp.length ? q.all.pp.join(' / ') : '—';
        const ing = q.all.ing || '—';
        const third = q.all.third || '—';
        const regular = q.all.past.length && classifyRegular(base, q.all.past[0]);
        const explain = regular
            ? '规则动词：原形 + -ed（注意拼写规则）。Regular verb formed with -ed.'
            : '不规则动词：需要单独记忆。Irregular verb — memorize the forms.';
        return `
            <div style="margin-top:8px;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:13px;line-height:1.6;">
                <div><strong>原形 Base:</strong> ${escapeHtml(base)}</div>
                <div><strong>过去式 Past:</strong> ${escapeHtml(past)}</div>
                <div><strong>过去分词 Past Participle:</strong> ${escapeHtml(pp)}</div>
                <div><strong>现在分词 -ing:</strong> ${escapeHtml(ing)} · <strong>第三人称 3sg:</strong> ${escapeHtml(third)}</div>
                <div style="margin-top:6px;color:var(--text-light);">${escapeHtml(explain)}</div>
            </div>`;
    }

    function next() {
        state.index += 1;
        if (state.index >= state.questions.length) { renderFinish(); return; }
        renderQuestion();
    }

    function renderFinish() {
        state.finished = true;
        try { reportPracticeLog(); } catch (_) {}
        const total = state.questions.length;
        const pct = total ? Math.round(state.score * 100 / total) : 0;
        $('vg-meta').textContent = '';
        $('vg-body').innerHTML = `
            <div style="text-align:center;padding:20px 10px;">
                <div style="font-size:48px;">${pct >= 80 ? '🏆' : pct >= 60 ? '🎉' : '💪'}</div>
                <div style="font-size:22px;font-weight:700;margin-top:6px;">${state.score} / ${total} · ${pct}%</div>
                <div style="color:var(--text-light);margin-top:6px;">${pct >= 80 ? '太棒了！Excellent!' : pct >= 60 ? '继续加油 Keep going!' : '多练几遍会更好 Try again!'}</div>
                ${state.wrongItems.length ? `<div style="color:var(--text-light);font-size:12px;margin-top:8px;">错题已记入错题本</div>` : ''}
            </div>`;
        $('vg-submit').style.display = 'none';
        $('vg-next').style.display = 'none';
        $('vg-show-answer').style.display = 'none';
        $('vg-skip').style.display = 'none';
    }

    window.VerbGame = { start, startWithUnit, close };
})();
