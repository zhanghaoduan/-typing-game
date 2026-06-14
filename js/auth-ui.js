/* ============================================
   Auth UI Module - Login/Register/Session management
   用户认证界面模块
   ============================================ */

const AuthUI = (() => {
    const API_BASE = '/api';
    let currentUser = null;
    let token = null;

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
            App.showPage('page-home');
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async function register(username, password) {
        try {
            const res = await fetch(`${API_BASE}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
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
            App.showPage('page-home');
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
                userInfo.innerHTML = `
                    <span class="user-badge ${isAdmin() ? 'admin' : ''}">
                        ${isAdmin() ? '👑' : '👤'} ${currentUser.username}
                    </span>
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
        const errorEl = document.getElementById('register-error');

        if (!username || !password) {
            errorEl.textContent = '请输入用户名和密码 Please enter username and password';
            return;
        }

        if (password !== confirm) {
            errorEl.textContent = '两次密码不一致 Passwords do not match';
            return;
        }

        errorEl.textContent = '';
        register(username, password).then(result => {
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
        updateAuthUI
    };
})();
