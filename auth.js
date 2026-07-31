// auth.js - shared auth helpers backed by the server-side session API
(function () {
  let supportRoles = Object.create(null);

  const state = {
    currentUser: null,
    loaded: false,
    loadingPromise: null,
    sessionToken: null,
    csrfToken: null,
    csrfTokenPromise: null
  };

  const SESSION_TOKEN_STORAGE_KEY = 'cwsSessionToken';
  const CSRF_COOKIE_NAME = 'cws_csrf';
  const BACKEND_OFFLINE_HINT_ID = 'cwsBackendOfflineHint';

  const DEFAULT_HOSTED_API_BASE = 'https://creative-solutions.onrender.com';
  const DEFAULT_LOCAL_API_BASE = 'http://localhost:3000';
  const DEFAULT_LOCAL_API_PORT = 3000;

  function getLocalApiPort() {
    if (typeof window === 'undefined') {
      return DEFAULT_LOCAL_API_PORT;
    }

    const explicitPort = window.CWS_API_BASE_PORT;
    if (explicitPort != null) {
      const port = Number(String(explicitPort).trim());
      if (Number.isInteger(port) && port > 0 && port <= 65535) {
        return port;
      }
    }

    return DEFAULT_LOCAL_API_PORT;
  }

  function loadStoredSessionToken() {
    if (typeof localStorage === 'undefined') return null;
    const token = String(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY) || '').trim();
    return token || null;
  }

  function saveSessionToken(token) {
    const normalized = String(token || '').trim();
    state.sessionToken = normalized || null;
    if (typeof localStorage === 'undefined') return;
    if (state.sessionToken) {
      localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, state.sessionToken);
    } else {
      localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
    }
  }

  saveSessionToken(loadStoredSessionToken());

  function isLocalHostName(hostname) {
    const normalized = String(hostname || '').toLowerCase();
    return normalized === 'localhost' || normalized === '127.0.0.1';
  }

  function getApiBase() {
    const explicitBase = typeof window !== 'undefined' ? window.CWS_API_BASE : '';
    if (explicitBase) {
      return String(explicitBase).replace(/\/+$/, '');
    }

    if (typeof window === 'undefined' || !window.location) {
      return '';
    }

    const { protocol, hostname, port } = window.location;
    const normalizedHost = String(hostname || '').toLowerCase();

    if (protocol === 'file:') {
      const port = getLocalApiPort();
      return `http://localhost:${port}`;
    }

    if (normalizedHost.endsWith('.github.io')) {
      return DEFAULT_HOSTED_API_BASE;
    }

    // When the site is running on localhost or 127.0.0.1, route auth calls
    // to the local Node backend on the desired port instead of the current
    // preview port.
    if (isLocalHostName(normalizedHost)) {
      const port = getLocalApiPort();
      return `http://${normalizedHost}:${port}`;
    }

    // For other HTTP/HTTPS pages, use the same origin as the frontend.
    if (protocol === 'http:' || protocol === 'https:') {
      return window.location.origin;
    }

    return '';
  }

  function getRequestCredentials() {
    const base = getApiBase();
    if (!base || typeof window === 'undefined' || !window.location) {
      return 'same-origin';
    }

    try {
      return new URL(base).origin === window.location.origin ? 'same-origin' : 'include';
    } catch (_error) {
      return 'include';
    }
  }

  function buildApiUrl(path) {
    const normalizedPath = String(path || '').startsWith('/') ? path : `/${path || ''}`;
    const base = getApiBase();
    return base ? `${base}${normalizedPath}` : normalizedPath;
  }

  function safeParse(value, fallback) {
    try {
      const parsed = JSON.parse(value);
      return parsed == null ? fallback : parsed;
    } catch (error) {
      return fallback;
    }
  }

  function readCookie(name) {
    if (typeof document === 'undefined') return '';
    const cookies = String(document.cookie || '').split(';').map((part) => part.trim());
    const match = cookies.find((entry) => entry.startsWith(`${name}=`));
    if (!match) return '';
    return decodeURIComponent(match.slice(name.length + 1));
  }

  function getCsrfToken() {
    const token = String(readCookie(CSRF_COOKIE_NAME) || '').trim();
    state.csrfToken = token || null;
    return state.csrfToken;
  }

  function isMutatingMethod(method) {
    const normalized = String(method || 'GET').toUpperCase();
    return !['GET', 'HEAD', 'OPTIONS'].includes(normalized);
  }

  async function ensureCsrfToken() {
    const existingToken = getCsrfToken();
    if (existingToken) {
      return existingToken;
    }

    if (!state.csrfTokenPromise) {
      state.csrfTokenPromise = (async () => {
        try {
          await fetch(buildApiUrl('/api/auth/meta'), {
            method: 'GET',
            credentials: getRequestCredentials(),
            headers: {
              Accept: 'application/json'
            }
          });
        } catch (_error) {
          // Ignore bootstrap errors; the next request will fail with a clear server response if needed.
        }
        return getCsrfToken();
      })().finally(() => {
        state.csrfTokenPromise = null;
      });
    }

    return state.csrfTokenPromise;
  }

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function hydrateSupportRoles(meta) {
    const roles = meta && meta.supportRoles && typeof meta.supportRoles === 'object'
      ? meta.supportRoles
      : null;
    if (!roles) return;

    const normalizedRoles = Object.create(null);
    for (const [email, role] of Object.entries(roles)) {
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail || !role) continue;
      normalizedRoles[normalizedEmail] = String(role);
    }
    supportRoles = normalizedRoles;
  }

  function isSupportSession(user) {
    return Boolean(
      user
      && (user.role === 'support' || user.role === 'admin')
      && (user.supportRole || getSupportRoleForEmail(user.email))
    );
  }

  function getAuthorizedSupportEmails() {
    return Object.keys(supportRoles);
  }

  function getSupportRoleForEmail(email) {
    return supportRoles[normalizeEmail(email)] || null;
  }

  function toAppUrl(path) {
    const target = String(path || '').trim();
    if (!target) return '';
    if (/^(?:[a-z]+:)?\/\//i.test(target) || target.startsWith('#')) {
      return target;
    }

    const normalizedPath = target.replace(/^\/+/, '');
    if (typeof window === 'undefined' || !window.location) {
      return normalizedPath;
    }

    if (window.location.protocol === 'file:' && window.CWS_API_BASE) {
      const base = String(window.CWS_API_BASE).replace(/\/+$/, '');
      return `${base}/${normalizedPath}`;
    }

    return normalizedPath;
  }

  function isSystemAdministrator(value) {
    if (!value) return false;
    if (typeof value === 'string') {
      return value === 'System Administrator';
    }

    if (value.supportRole) {
      return value.supportRole === 'System Administrator';
    }

    if (value.role === 'admin' || value.role === 'System Administrator') {
      return true;
    }

    if (value.email) {
      return getSupportRoleForEmail(value.email) === 'System Administrator';
    }

    return false;
  }

  function getSupportLandingPage(value) {
    return isSystemAdministrator(value) ? 'system-admin.html' : 'support-portal.html';
  }

  function getSupportLandingUrl(value) {
    return toAppUrl(getSupportLandingPage(value));
  }

  function getSupportOnlineAgents() {
    const stored = safeParse(localStorage.getItem('supportOnlineAgents') || '[]', []);
    if (!Array.isArray(stored)) return [];
    const authorized = getAuthorizedSupportEmails();
    if (authorized.length === 0) {
      return [...new Set(stored.map(normalizeEmail).filter(Boolean))];
    }
    return [...new Set(
      stored
        .map(normalizeEmail)
        .filter((email) => authorized.includes(email))
    )];
  }

  function saveSupportOnlineAgents(emails) {
    localStorage.setItem('supportOnlineAgents', JSON.stringify(
      [...new Set((emails || []).map(normalizeEmail))]
    ));
  }

  function removeOnlineAgent(email) {
    const normalized = normalizeEmail(email);
    const remaining = getSupportOnlineAgents().filter((item) => item !== normalized);
    saveSupportOnlineAgents(remaining);
  }

  function addOnlineAgent(email) {
    const normalized = normalizeEmail(email);
    if (!normalized) return;
    const roster = getSupportOnlineAgents();
    if (!roster.includes(normalized)) {
      roster.push(normalized);
      saveSupportOnlineAgents(roster);
    }
  }

  function setCurrentUser(user) {
    state.currentUser = user || null;
    state.loaded = true;
    return state.currentUser;
  }

  function buildHealthUrl() {
    return String(buildApiUrl('/health'));
  }

  function hideBackendOfflineHint() {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById(BACKEND_OFFLINE_HINT_ID);
    if (existing) {
      existing.style.display = 'none';
    }
  }

  function showBackendOfflineHint() {
    if (typeof document === 'undefined' || !document.body) return;

    // Login pages render their own dedicated offline hints.
    if (document.getElementById('localServerHint') || document.getElementById('supportLocalServerHint')) {
      return;
    }

    let panel = document.getElementById(BACKEND_OFFLINE_HINT_ID);
    if (!panel) {
      panel = document.createElement('section');
      panel.id = BACKEND_OFFLINE_HINT_ID;
      panel.setAttribute('role', 'status');
      panel.setAttribute('aria-live', 'polite');
      panel.className = 'cws-backend-offline-hint';
      panel.innerHTML = [
        '<strong class="cws-backend-offline-hint-title">Local backend is unreachable.</strong>',
        '<div class="auth-meta cws-backend-offline-hint-note">Run this in the project folder:</div>',
        '<pre id="cwsBackendOfflineCmd" class="cws-backend-offline-hint-copy">start-local.cmd</pre>',
        '<div class="cws-backend-offline-hint-actions">',
        '  <button id="cwsCopyBackendCmd" type="button" class="ghost-btn">Copy command</button>',
        '  <a id="cwsOpenHealth" target="_blank" rel="noopener noreferrer" class="ghost-btn">Open /health</a>',
        '  <button id="cwsDismissBackendHint" type="button" class="ghost-btn">Dismiss</button>',
        '</div>'
      ].join('');

      document.body.appendChild(panel);

      const copyBtn = panel.querySelector('#cwsCopyBackendCmd');
      const commandEl = panel.querySelector('#cwsBackendOfflineCmd');
      const dismissBtn = panel.querySelector('#cwsDismissBackendHint');

      copyBtn.addEventListener('click', async () => {
        const command = commandEl ? String(commandEl.textContent || '').trim() : 'start-local.cmd';
        try {
          await navigator.clipboard.writeText(command);
          copyBtn.textContent = 'Copied';
        } catch (_error) {
          copyBtn.textContent = 'Copy failed';
        }

        setTimeout(() => {
          copyBtn.textContent = 'Copy command';
        }, 1400);
      });

      dismissBtn.addEventListener('click', () => {
        panel.style.display = 'none';
      });
    }

    const healthLink = panel.querySelector('#cwsOpenHealth');
    if (healthLink) {
      healthLink.setAttribute('href', buildHealthUrl());
    }

    panel.style.display = 'block';
  }

  async function apiRequest(path, options) {
    const requestOptions = Object.assign({
      credentials: getRequestCredentials(),
      headers: {
        Accept: 'application/json'
      }
    }, options || {});

    if (requestOptions.body && !requestOptions.headers['Content-Type']) {
      requestOptions.headers['Content-Type'] = 'application/json';
    }

    if (state.sessionToken && !requestOptions.headers['X-CWS-Session']) {
      requestOptions.headers['X-CWS-Session'] = state.sessionToken;
    }

    if (isMutatingMethod(requestOptions.method)) {
      const csrfToken = await ensureCsrfToken();
      if (csrfToken && !requestOptions.headers['X-CSRF-Token']) {
        requestOptions.headers['X-CSRF-Token'] = csrfToken;
      }
    }

    const requestUrl = buildApiUrl(path);
    const localFallbackUrls = (() => {
      if (typeof window === 'undefined' || !window.location) return [];
      const host = String(window.location.hostname || '').toLowerCase();
      if (!isLocalHostName(host)) return [];

      const fallbackPorts = new Set();
      const candidatePorts = [getLocalApiPort(), 3000, 3100, 5000, 8000, 8080].filter((port, index, ports) => {
        const numericPort = Number(port);
        return Number.isInteger(numericPort) && numericPort > 0 && numericPort <= 65535 && ports.indexOf(port) === index;
      });
      const url = (() => {
        try {
          return new URL(requestUrl);
        } catch (_error) {
          return null;
        }
      })();
      if (!url) return [];

      const currentPort = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
      for (const port of candidatePorts) {
        if (port !== currentPort) {
          fallbackPorts.add(port);
        }
      }

      return Array.from(fallbackPorts).map((port) => {
        const copy = new URL(requestUrl);
        copy.port = String(port);
        return copy.toString();
      });
    })();

    let response;
    let lastError = null;
    const candidateUrls = [requestUrl, ...localFallbackUrls];
    for (const url of candidateUrls) {
      try {
        response = await fetch(url, requestOptions);
      } catch (networkError) {
        lastError = networkError;
        continue;
      }

      if (response.ok) {
        break;
      }

      if (url === requestUrl && localFallbackUrls.length > 0) {
        continue;
      }
      break;
    }

    if (!response) {
      const configuredBase = getApiBase();
      const target = configuredBase || 'same-origin backend';
      showBackendOfflineHint();
      throw new Error(`Unable to reach the login server (${target}). If you are running the site locally, start the Node backend and make sure it is reachable on the expected local port. You can also set window.CWS_API_BASE or window.CWS_API_BASE_PORT.`);
    }

    let payload = response.status === 204 ? null : await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error((payload && payload.error) || 'Request failed');
      error.response = response;
      error.payload = payload;
      throw error;
    }

    hideBackendOfflineHint();

    return payload;
  }

  async function init(forceRefresh) {
    if (!forceRefresh && state.loaded) {
      return state.currentUser;
    }

    if (!forceRefresh && state.loadingPromise) {
      return state.loadingPromise;
    }

    state.loadingPromise = apiRequest('/api/auth/session', { method: 'GET' })
      .then((payload) => {
        if (payload && payload.sessionToken) {
          saveSessionToken(payload.sessionToken);
        }
        if (payload && payload.authenticated) {
          return setCurrentUser(payload.user);
        }
        saveSessionToken(null);
        return setCurrentUser(null);
      })
      .catch(() => setCurrentUser(null))
      .finally(() => {
        state.loadingPromise = null;
      });

    return state.loadingPromise;
  }

  function getCustomer() {
    return state.currentUser && state.currentUser.role === 'customer' ? state.currentUser : null;
  }

  function getSupport() {
    return isSupportSession(state.currentUser)
      ? {
          email: state.currentUser.email,
          name: state.currentUser.name,
          role: state.currentUser.supportRole || getSupportRoleForEmail(state.currentUser.email)
        }
      : null;
  }

  function setCustomer(customer) {
    if (!customer || !customer.email) {
      return null;
    }
    return setCurrentUser(Object.assign({}, customer, { role: 'customer', email: normalizeEmail(customer.email) }));
  }

  function setSupport(staff) {
    if (!staff || !staff.email) {
      return null;
    }
    const email = normalizeEmail(staff.email);
    const role = staff.supportRole || staff.role || getSupportRoleForEmail(email);
    if (!role) {
      return null;
    }
    addOnlineAgent(email);
    return setCurrentUser({
      role: staff.role === 'admin' ? 'admin' : 'support',
      email,
      name: staff.name || 'Support Agent',
      supportRole: role
    });
  }

  function clearCustomer() {
    if (state.currentUser && state.currentUser.role === 'customer') {
      setCurrentUser(null);
    }
  }

  function clearSupport() {
    const support = getSupport();
    if (support && support.email) {
      removeOnlineAgent(support.email);
    }
    if (isSupportSession(state.currentUser)) {
      setCurrentUser(null);
    }
  }

  async function hasRegisteredAccounts() {
    const payload = await apiRequest('/api/auth/meta', { method: 'GET' });
    hydrateSupportRoles(payload);
    return Boolean(payload && payload.hasCustomerAccounts);
  }

  async function getAuthHealth() {
    try {
      return await apiRequest('/health', { method: 'GET' });
    } catch (_error) {
      return null;
    }
  }

  async function getAuthStatus() {
    const health = await getAuthHealth();
    if (health && health.status === 'ok') {
      try {
        const meta = await apiRequest('/api/auth/meta', { method: 'GET' });
        hydrateSupportRoles(meta);
        return {
          online: true,
          health,
          meta: meta || null,
          metaUrl: buildApiUrl('/api/auth/meta')
        };
      } catch (_error) {
        return {
          online: true,
          health,
          meta: null,
          metaUrl: buildApiUrl('/api/auth/meta')
        };
      }
    }

    const meta = await apiRequest('/api/auth/meta', { method: 'GET' }).catch(() => null);
    hydrateSupportRoles(meta);
    return {
      online: Boolean(meta),
      health: health || null,
      meta: meta || null,
      metaUrl: buildApiUrl('/api/auth/meta')
    };
  }

  async function getAuthMeta() {
    const meta = await apiRequest('/api/auth/meta', { method: 'GET' });
    hydrateSupportRoles(meta);
    return meta;
  }

  function isCustomerLoggedIn() {
    return Boolean(getCustomer());
  }

  function isSupportLoggedIn() {
    return Boolean(getSupport());
  }

  async function requireCustomer(redirectTo) {
    const customer = await init();
    if (!customer || customer.role !== 'customer') {
      clearCustomer();
      if (redirectTo) window.location.href = toAppUrl(redirectTo);
      return null;
    }
    return customer;
  }

  async function requireSupport(redirectTo) {
    const support = await init();
    if (!isSupportSession(support)) {
      clearSupport();
      if (redirectTo) window.location.href = toAppUrl(redirectTo);
      return null;
    }
    addOnlineAgent(support.email);
    return getSupport();
  }

  async function redirectIfCustomer(redirectTo) {
    const user = await init();
    if (user && user.role === 'customer' && redirectTo) {
      window.location.href = toAppUrl(redirectTo);
      return true;
    }
    return false;
  }

  async function redirectIfSupport(redirectTo) {
    const user = await init();
    if (isSupportSession(user) && redirectTo) {
      window.location.href = toAppUrl(redirectTo);
      return true;
    }
    return false;
  }

  async function signupCustomer(payload) {
    const result = await apiRequest('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        name: payload.name,
        email: normalizeEmail(payload.email),
        password: payload.password
      })
    });
    clearSupport();
    if (result && result.user) {
      setCustomer(result.user);
    }
    saveSessionToken(result && result.sessionToken);
    return result;
  }

  async function loginCustomer(payload) {
    const result = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: normalizeEmail(payload.email),
        password: payload.password
      })
    });
    clearSupport();
    saveSessionToken(result && result.sessionToken);
    setCustomer(result && result.user);
    return result && result.user;
  }

  async function loginSupport(payload) {
    const result = await apiRequest('/api/auth/support-login', {
      method: 'POST',
      body: JSON.stringify({
        email: normalizeEmail(payload.email),
        password: payload.password
      })
    });
    await getAuthMeta().catch(() => null);
    saveSessionToken(result && result.sessionToken);
    setSupport(result && result.user);
    return result && result.user;
  }

  async function updateCustomerProfile(payload) {
    const result = await apiRequest('/api/auth/customer-profile', {
      method: 'PATCH',
      body: JSON.stringify({
        name: payload.name,
        email: normalizeEmail(payload.email),
        plan: payload.plan,
        notifications: Boolean(payload.notifications)
      })
    });
    setCustomer(result && result.user);
    return result && result.user;
  }

  async function requestPasswordReset(email) {
    return apiRequest('/api/auth/password-reset/request', {
      method: 'POST',
      body: JSON.stringify({ email: normalizeEmail(email) })
    });
  }

  async function confirmPasswordReset(token, password) {
    return apiRequest('/api/auth/password-reset/confirm', {
      method: 'POST',
      body: JSON.stringify({ token: String(token || '').trim(), password })
    });
  }

  async function requestSupportPasswordReset(email) {
    return apiRequest('/api/auth/support-password-reset/request', {
      method: 'POST',
      body: JSON.stringify({ email: normalizeEmail(email) })
    });
  }

  async function confirmSupportPasswordReset(token, password) {
    return apiRequest('/api/auth/support-password-reset/confirm', {
      method: 'POST',
      body: JSON.stringify({ token: String(token || '').trim(), password })
    });
  }

  async function verifyEmail(token) {
    return apiRequest('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token: String(token || '').trim() })
    });
  }

  async function logout(redirectTo) {
    const support = getSupport();
    try {
      await apiRequest('/api/auth/logout', {
        method: 'POST'
      });
    } catch (error) {
      // Ignore logout network errors and clear local state anyway.
    }
    if (support && support.email) {
      removeOnlineAgent(support.email);
    }
    saveSessionToken(null);
    setCurrentUser(null);
    if (redirectTo) {
      window.location.href = toAppUrl(redirectTo);
    }
  }

  async function logoutCustomer(redirectTo) {
    await logout(redirectTo);
  }

  async function logoutSupport(redirectTo) {
    await logout(redirectTo);
  }

  window.SiteAuth = {
    safeParse,
    normalizeEmail,
    buildApiUrl,
    toAppUrl,
    apiRequest,
    getAuthorizedSupportEmails,
    getSupportRoleForEmail,
    isSystemAdministrator,
    getSupportLandingPage,
    getSupportLandingUrl,
    getSupportOnlineAgents,
    saveSupportOnlineAgents,
    addOnlineAgent,
    removeOnlineAgent,
    init,
    getCustomer,
    getSupport,
    setCustomer,
    setSupport,
    clearCustomer,
    clearSupport,
    hasRegisteredAccounts,
    getAuthHealth,
    getAuthStatus,
    getAuthMeta,
    isCustomerLoggedIn,
    isSupportLoggedIn,
    requireCustomer,
    requireSupport,
    redirectIfCustomer,
    redirectIfSupport,
    signupCustomer,
    loginCustomer,
    loginSupport,
    updateCustomerProfile,
    requestPasswordReset,
    confirmPasswordReset,
    requestSupportPasswordReset,
    confirmSupportPasswordReset,
    verifyEmail,
    logoutCustomer,
    logoutSupport
  };
})();