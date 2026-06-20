/* ============================================
   Auth UI Module - Login/Register/Session management
   用户认证界面模块
   ============================================ */

const AuthUI = (() => {
    const API_BASE = '/api';
    let currentUser = null;
    let token = null;

    // Shared grade list (also used by ocr.js for filtering)
    const GRADE_LIST = [
        '小学三年级上','小学三年级下','小学四年级上','小学四年级下','小学五年级上','小学五年级下','小学六年级上','小学六年级下',
        '初一上','初一下','初二上','初二下','初三上','初三下',
        '高一上','高一下','高二上','高二下','高三上','高三下'
    ];

    function populateGradeSelect(selectEl, current) {
        if (!selectEl) return;
        // Keep first placeholder option, append grade options
        const placeholder = selectEl.querySelector('option[value=""]');
        selectEl.innerHTML = '';
        if (placeholder) selectEl.appendChild(placeholder);
        else {
            const ph = document.createElement('option');
            ph.value = ''; ph.textContent = '请选择 Please choose';
            selectEl.appendChild(ph);
        }
        GRADE_LIST.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g; opt.textContent = g;
            if (current && current === g) opt.selected = true;
            selectEl.appendChild(opt);
        });
    }

    function init() {
        // Load saved token
        token = localStorage.getItem('typing_game_token');
        const savedUser = localStorage.getItem('typing_game_user');
        if (savedUser) {
            try {
                currentUser = JSON.parse(savedUser);
            } catch (e) {
                currentUser = null;
            }
        }

        // Pre-populate register form grade
        populateGradeSelect(document.getElementById('register-grade'));

        // Update UI based on login state
        updateAuthUI();

        // If token exists, verify it
        if (token) {
            verifyToken();
        }
    }

    function getToken() {
        return token;
    }

    function getUser() {
        return currentUser;
    }

    function isLoggedIn() {
        return !!token && !!currentUser;
    }

    function isAdmin() {
        return currentUser && currentUser.role === 'admin';
    }

    async function verifyToken() {
        try {
            const res = await fetch(`${API_BASE}/units`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.status === 401) {
                logout();
            } else {
                // Refresh profile (so we always have up-to-date grade)
                try {
                    const pres = await fetch(`${API_BASE}/me/profile`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (pres.ok) {
                        const pdata = await pres.json();
                        if (pdata.user) {
                            currentUser = { ...currentUser, ...pdata.user };
                            localStorage.setItem('typing_game_user', JSON.stringify(currentUser));
                            updateAuthUI();
                        }
                    }
                } catch (e) { /* ignore */ }

                if (typeof Storage !== 'undefined' && Storage.syncFromServer) {
                    await Storage.syncFromServer();
                    if (typeof App !== 'undefined' && App.updateHomeStats) App.updateHomeStats();
                }
                maybePromptGrade();
            }
        } catch (e) {
            // Network error, keep token for offline use
        }
    }

    async function login(username, password) {
        try {
            const res = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || '登录失败 Login failed');
            }

            token = data.token;
            currentUser = data.user;
            localStorage.setItem('typing_game_token', token);
            localStorage.setItem('typing_game_user', JSON.stringify(currentUser));
            updateAuthUI();
            if (typeof Storage !== 'undefined' && Storage.syncFromServer) {
                await Storage.syncFromServer();
                if (typeof App !== 'undefined' && App.updateHomeStats) App.updateHomeStats();
            }
            App.showPage('page-home');
            maybePromptGrade();
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async function register(username, password, grade) {
        try {
            const res = await fetch(`${API_BASE}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, grade: grade || '' })
            });
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || '注册失败 Registration failed');
            }

            token = data.token;
            currentUser = data.user;
            localStorage.setItem('typing_game_token', token);
            localStorage.setItem('typing_game_user', JSON.stringify(currentUser));
            updateAuthUI();
            if (typeof Storage !== 'undefined' && Storage.syncFromServer) {
                await Storage.syncFromServer();
                if (typeof App !== 'undefined' && App.updateHomeStats) App.updateHomeStats();
            }
            App.showPage('page-home');
            maybePromptGrade();
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    function logout() {
        token = null;
        currentUser = null;
        localStorage.removeItem('typing_game_token');
        localStorage.removeItem('typing_game_user');
        updateAuthUI();
        App.showPage('page-login');
    }

    function updateAuthUI() {
        const loginPage = document.getElementById('page-login');
        const homeButtons = document.querySelector('.home-footer');
        const userInfo = document.getElementById('user-info');
        const adminBtn = document.getElementById('admin-panel-btn');

        if (userInfo) {
            if (isLoggedIn()) {
                const gradeBadge = currentUser.grade
                    ? `<span class="user-grade-badge" title="点击修改 Click to change" onclick="AuthUI.openSetGrade(false)">🎓 ${escapeHtmlAttr(currentUser.grade)}</span>`
                    : `<button class="btn btn-small btn-outline" onclick="AuthUI.openSetGrade(false)">选择年级 Set Grade</button>`;
                userInfo.innerHTML = `
                    <span class="user-badge ${isAdmin() ? 'admin' : ''}">
                        ${isAdmin() ? '👑' : '👤'} ${escapeHtmlAttr(currentUser.username)}
                    </span>
                    ${gradeBadge}
                    <button class="btn btn-small btn-outline" title="修改密码 Change Password" onclick="AuthUI.openChangePassword()">⚙</button>
                    <button class="btn btn-small btn-outline" onclick="AuthUI.logout()">退出 Logout</button>
                `;
                userInfo.style.display = 'flex';
            } else {
                userInfo.style.display = 'none';
            }
        }

        if (adminBtn) {
            adminBtn.style.display = isAdmin() ? 'block' : 'none';
        }

        const materialCard = document.getElementById('home-material-card');
        if (materialCard) {
            materialCard.style.display = isAdmin() ? 'flex' : 'none';
        }
    }

    // Handle login form
    function handleLogin() {
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;
        const errorEl = document.getElementById('login-error');

        if (!username || !password) {
            errorEl.textContent = '请输入用户名和密码 Please enter username and password';
            return;
        }

        errorEl.textContent = '';
        login(username, password).then(result => {
            if (!result.success) {
                errorEl.textContent = result.error;
            }
        });
    }

    // Handle register form
    function handleRegister() {
        const username = document.getElementById('register-username').value.trim();
        const password = document.getElementById('register-password').value;
        const confirm = document.getElementById('register-confirm').value;
        const gradeEl = document.getElementById('register-grade');
        const grade = gradeEl ? gradeEl.value : '';
        const errorEl = document.getElementById('register-error');

        if (!username || !password) {
            errorEl.textContent = '请输入用户名和密码 Please enter username and password';
            return;
        }

        if (password !== confirm) {
            errorEl.textContent = '两次密码不一致 Passwords do not match';
            return;
        }

        if (!grade) {
            errorEl.textContent = '请选择年级 Please choose your grade';
            return;
        }

        errorEl.textContent = '';
        register(username, password, grade).then(result => {
            if (!result.success) {
                errorEl.textContent = result.error;
            }
        });
    }

    // Show login/register tab
    function showTab(tab) {
        document.getElementById('login-form').style.display = tab === 'login' ? 'block' : 'none';
        document.getElementById('register-form').style.display = tab === 'register' ? 'block' : 'none';
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        document.querySelector(`.auth-tab[data-tab="${tab}"]`).classList.add('active');
    }

    // API helper with auth header
    async function apiRequest(url, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        const res = await fetch(`${API_BASE}${url}`, { ...options, headers });
        if (res.status === 401) {
            logout();
            throw new Error('登录已过期 Session expired');
        }
        return res;
    }

    // Change password modal
    function openChangePassword() {
        const modal = document.getElementById('modal-change-password');
        if (!modal) return;
        document.getElementById('cp-old').value = '';
        document.getElementById('cp-new').value = '';
        document.getElementById('cp-confirm').value = '';
        document.getElementById('cp-error').textContent = '';
        modal.style.display = 'flex';
    }

    function closeChangePassword() {
        const modal = document.getElementById('modal-change-password');
        if (modal) modal.style.display = 'none';
    }

    async function submitChangePassword() {
        const oldPassword = document.getElementById('cp-old').value;
        const newPassword = document.getElementById('cp-new').value;
        const confirmPwd = document.getElementById('cp-confirm').value;
        const errEl = document.getElementById('cp-error');
        errEl.textContent = '';
        if (!oldPassword || !newPassword) {
            errEl.textContent = '请输入旧密码和新密码 Please enter old and new password';
            return;
        }
        if (newPassword.length < 4) {
            errEl.textContent = '新密码至少4个字符 New password must be at least 4 characters';
            return;
        }
        if (newPassword !== confirmPwd) {
            errEl.textContent = '两次密码不一致 Passwords do not match';
            return;
        }
        try {
            const res = await apiRequest('/auth/change-password', {
                method: 'POST',
                body: JSON.stringify({ oldPassword, newPassword })
            });
            const data = await res.json();
            if (!res.ok) {
                errEl.textContent = data.error || '修改失败 Failed';
                return;
            }
            alert('密码已修改 Password updated');
            closeChangePassword();
        } catch (e) {
            errEl.textContent = e.message || '修改失败 Failed';
        }
    }

    // ========== Set Grade modal ==========
    let _gradePromptForced = false;

    function maybePromptGrade() {
        if (!isLoggedIn()) return;
        if (currentUser && !currentUser.grade && currentUser.role !== 'admin') {
            openSetGrade(true);
        }
    }

    function openSetGrade(forced) {
        const modal = document.getElementById('modal-set-grade');
        if (!modal) return;
        _gradePromptForced = !!forced;
        const sel = document.getElementById('sg-grade');
        populateGradeSelect(sel, currentUser ? currentUser.grade : '');
        document.getElementById('sg-error').textContent = '';
        const cancelBtn = document.getElementById('sg-cancel');
        if (cancelBtn) cancelBtn.style.display = forced ? 'inline-block' : 'inline-block';
        modal.style.display = 'flex';
    }

    function closeSetGrade() {
        const modal = document.getElementById('modal-set-grade');
        if (modal) modal.style.display = 'none';
    }

    async function submitSetGrade() {
        const sel = document.getElementById('sg-grade');
        const errEl = document.getElementById('sg-error');
        errEl.textContent = '';
        const grade = sel ? sel.value : '';
        if (!grade) {
            errEl.textContent = '请选择年级 Please choose a grade';
            return;
        }
        try {
            const res = await apiRequest('/me/profile', {
                method: 'PUT',
                body: JSON.stringify({ grade })
            });
            const data = await res.json();
            if (!res.ok) {
                errEl.textContent = data.error || '保存失败 Failed';
                return;
            }
            currentUser = { ...currentUser, ...data.user };
            localStorage.setItem('typing_game_user', JSON.stringify(currentUser));
            updateAuthUI();
            closeSetGrade();
            // Refresh "我的作业本" if currently rendered, so default filter applies
            if (typeof ImageOCR !== 'undefined' && ImageOCR.renderSavedUnits) {
                try { ImageOCR.renderSavedUnits(); } catch (e) {}
            }
        } catch (e) {
            errEl.textContent = e.message || '保存失败 Failed';
        }
    }

    function escapeHtmlAttr(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    return {
        init,
        getToken,
        getUser,
        isLoggedIn,
        isAdmin,
        login,
        register,
        logout,
        handleLogin,
        handleRegister,
        showTab,
        apiRequest,
        updateAuthUI,
        openChangePassword,
        closeChangePassword,
        submitChangePassword,
        openSetGrade,
        closeSetGrade,
        submitSetGrade,
        GRADE_LIST
    };
})();
