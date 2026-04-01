// auth.js - shared auth helpers backed by the server-side session API
(function () {
  // Resolve the API base URL so this file works whether the page is served
  // from the Node backend (localhost / Render) OR from GitHub Pages.
  // Set window.CWS_API_BASE before loading this script to override.
  const API_BASE = (function () {
    if (typeof window !== 'undefined' && window.CWS_API_BASE) {
      return window.CWS_API_BASE.replace(/\/$/, '');
    }
    const hostname = (typeof location !== 'undefined' && location.hostname) || '';
    // Running on GitHub Pages — point at the hosted Render backend.
    if (hostname === 'kyleb1.github.io') {
      return 'https://creative-solutions.onrender.com';
    }
    // Running from the Node server or localhost — use relative paths.
    return '';
  }());

  const CROSS_ORIGIN = API_BASE !== '';

  const SUPPORT_ROLES = Object.freeze({
    'support@creativewebsolutions.com': 'Support Agent',
    'helpdesk@creativewebsolutions.com': 'Support Agent',
    'kyle.creativesolutions@gmail.com': 'Support Administrator',
    'kyle.creativesolutins@gmail.com': 'System Administrator'
  });

  const state = {
    currentUser: null,
    loaded: false,
    loadingPromise: null
  };

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
      // Use 'include' for cross-origin (GitHub Pages → Render) so the
      // session cookie is sent and received correctly.
      credentials: CROSS_ORIGIN ? 'include' : 'same-origin',
      headers: {
        Accept: 'application/json'
      }
    }, options || {});

    if (requestOptions.body && !requestOptions.headers['Content-Type']) {
      requestOptions.headers['Content-Type'] = 'application/json';
    }

    // Prepend API_BASE so GitHub Pages requests go to the Render backend.
    const url = API_BASE + path;
    const response = await fetch(url, requestOptions);
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