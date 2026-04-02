// auth.js - shared auth helpers backed by the server-side session API
(function () {
  const SUPPORT_ROLES = Object.freeze({
    'support@creativewebsolutions.com': 'Support Agent',
    'helpdesk@creativewebsolutions.com': 'Support Agent',
    'admin@creativewebsolutions.com': 'System Administrator',
    'kyle.creativesolutions@gmail.com': 'System Administrator'
  });

  const state = {
    currentUser: null,
    loaded: false,
    loadingPromise: null
  };

  const DEFAULT_HOSTED_API_BASE = 'https://creative-solutions.onrender.com';

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

    if (normalizedHost === 'kyleb1.github.io') {
      return DEFAULT_HOSTED_API_BASE;
    }

    if (protocol === 'file:' || normalizedHost.endsWith('.github.io')) {
      return DEFAULT_HOSTED_API_BASE;
    }

    // When the site is opened from a local static server, route auth calls to
    // the Node backend on port 3100. When already on 3100, use same-origin.
    if (isLocalHostName(normalizedHost) && port && port !== '3100') {
      return `http://${normalizedHost}:3100`;
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

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function isSupportSession(user) {
    return Boolean(
      user
      && (user.role === 'support' || user.role === 'admin')
      && (user.supportRole || getSupportRoleForEmail(user.email))
    );
  }

  function getAuthorizedSupportEmails() {
    return Object.keys(SUPPORT_ROLES);
  }

  function getSupportRoleForEmail(email) {
    return SUPPORT_ROLES[normalizeEmail(email)] || null;
  }

  function getSupportOnlineAgents() {
    const stored = safeParse(localStorage.getItem('supportOnlineAgents') || '[]', []);
    if (!Array.isArray(stored)) return [];
    const authorized = getAuthorizedSupportEmails();
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

    const requestUrl = buildApiUrl(path);
    let response;
    try {
      response = await fetch(requestUrl, requestOptions);
    } catch (_networkError) {
      const configuredBase = getApiBase();
      const target = configuredBase || 'same-origin backend';
      throw new Error(`Unable to reach the login server (${target}). If you are running the site locally, start the Node backend or set window.CWS_API_BASE to your API URL.`);
    }
    const payload = response.status === 204 ? null : await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error((payload && payload.error) || 'Request failed');
      error.response = response;
      error.payload = payload;
      throw error;
    }

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
      .then((payload) => setCurrentUser(payload && payload.authenticated ? payload.user : null))
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
    return Boolean(payload && payload.hasCustomerAccounts);
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
      if (redirectTo) window.location.href = redirectTo;
      return null;
    }
    return customer;
  }

  async function requireSupport(redirectTo) {
    const support = await init();
    if (!isSupportSession(support)) {
      clearSupport();
      if (redirectTo) window.location.href = redirectTo;
      return null;
    }
    addOnlineAgent(support.email);
    return getSupport();
  }

  async function redirectIfCustomer(redirectTo) {
    const user = await init();
    if (user && user.role === 'customer' && redirectTo) {
      window.location.href = redirectTo;
      return true;
    }
    return false;
  }

  async function redirectIfSupport(redirectTo) {
    const user = await init();
    if (isSupportSession(user) && redirectTo) {
      window.location.href = redirectTo;
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
    setCustomer(result && result.user);
    return result && result.user;
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
    setCurrentUser(null);
    if (redirectTo) {
      window.location.href = redirectTo;
    }
  }

  async function logoutCustomer(redirectTo) {
    await logout(redirectTo);
  }

  async function logoutSupport(redirectTo) {
    await logout(redirectTo);
  }

  window.SiteAuth = {
    SUPPORT_ROLES,
    safeParse,
    normalizeEmail,
    buildApiUrl,
    apiRequest,
    getAuthorizedSupportEmails,
    getSupportRoleForEmail,
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
    logoutCustomer,
    logoutSupport
  };
})();