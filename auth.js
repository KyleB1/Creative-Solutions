// auth.js - shared client-side auth and role utilities for Creative Web Solutions
(function () {
  const SUPPORT_ROLES = Object.freeze({
    'support@creativewebsolutions.com': 'Support Agent',
    'helpdesk@creativewebsolutions.com': 'Support Agent',
    'kyle.creativesolutions@gmail.com': 'System Administrator'
  });

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

  function toHex(buffer) {
    return Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function fallbackDigest(value) {
    let hash = 2166136261;
    const input = String(value || '');
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
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
    return [...new Set(stored
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

  function getCustomer() {
    const customer = safeParse(localStorage.getItem('portalCustomer') || 'null', null);
    if (!customer || !customer.email) return null;
    if (!customer.role) customer.role = 'customer';
    if (customer.role !== 'customer') return null;
    customer.email = normalizeEmail(customer.email);
    return customer;
  }

  function getSupport() {
    const support = safeParse(localStorage.getItem('supportStaff') || 'null', null);
    if (!support || !support.email) return null;
    const email = normalizeEmail(support.email);
    const role = getSupportRoleForEmail(email);
    if (!role) return null;
    return {
      email,
      name: support.name || 'Support Agent',
      role
    };
  }

  function setCustomer(customer) {
    const payload = Object.assign({}, customer || {});
    if (!payload.email) return null;
    payload.email = normalizeEmail(payload.email);
    payload.role = 'customer';
    clearSupport();
    localStorage.setItem('portalCustomer', JSON.stringify(payload));
    return payload;
  }

  function setSupport(staff) {
    const payload = Object.assign({}, staff || {});
    const email = normalizeEmail(payload.email);
    const role = getSupportRoleForEmail(email);
    if (!email || !role) return null;
    clearCustomer();
    const normalized = {
      email,
      name: payload.name || 'Support Agent',
      role
    };
    localStorage.setItem('supportStaff', JSON.stringify(normalized));
    addOnlineAgent(email);
    return normalized;
  }

  function clearCustomer() {
    localStorage.removeItem('portalCustomer');
  }

  function clearSupport() {
    const existing = getSupport();
    if (existing && existing.email) {
      removeOnlineAgent(existing.email);
    }
    localStorage.removeItem('supportStaff');
  }

  function hasRegisteredAccounts() {
    const accounts = safeParse(localStorage.getItem('registeredAccounts') || '{}', {});
    return accounts && typeof accounts === 'object' && Object.keys(accounts).length > 0;
  }

  function isCustomerLoggedIn() {
    return Boolean(getCustomer());
  }

  function isSupportLoggedIn() {
    return Boolean(getSupport());
  }

  function isSupportAdmin() {
    const support = getSupport();
    const adminRoles = new Set(['Support Administrator', 'System Administrator']);
    return Boolean(support && adminRoles.has(support.role));
  }

  function generateSessionToken() {
    const cryptoObj = window.crypto || window.msCrypto;
    if (!cryptoObj || !cryptoObj.getRandomValues) {
      return 'session-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    }

    const bytes = new Uint8Array(24);
    cryptoObj.getRandomValues(bytes);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function hashPasswordWithSalt(salt, password) {
    const payload = String(salt || '') + ':' + String(password || '');
    const cryptoObj = window.crypto || window.msCrypto;
    if (cryptoObj && cryptoObj.subtle && typeof TextEncoder !== 'undefined') {
      const encoder = new TextEncoder();
      const digest = await cryptoObj.subtle.digest('SHA-256', encoder.encode(payload));
      return toHex(digest);
    }
    return fallbackDigest(payload);
  }

  async function verifyPassword(storedHash, password) {
    if (!storedHash || typeof storedHash !== 'string') return false;
    if (!storedHash.includes(':')) {
      return storedHash === password;
    }

    const separatorIndex = storedHash.indexOf(':');
    const salt = storedHash.slice(0, separatorIndex);
    const expectedHash = storedHash.slice(separatorIndex + 1);
    const computedHash = await hashPasswordWithSalt(salt, password);
    return expectedHash === computedHash;
  }

  function buildCustomerSession(account, overrides) {
    const source = Object.assign({}, account || {}, overrides || {});
    const email = normalizeEmail(source.email);
    const displayName = email.split('@')[0].replace(/[^a-zA-Z0-9]+/g, ' ').replace(/\b\w/g, function (char) {
      return char.toUpperCase();
    }) || 'Customer';

    return {
      customerId: source.customerId || 'cust-' + email.replace(/[^a-z0-9]/g, '').slice(0, 24),
      email,
      name: source.name || displayName,
      role: 'customer',
      plan: source.plan || 'Growth plan',
      renewal: source.renewal || 'May 18',
      activeProjects: source.activeProjects == null ? 8 : source.activeProjects,
      newLeads: source.newLeads == null ? 24 : source.newLeads,
      supportTickets: source.supportTickets == null ? 3 : source.supportTickets,
      monthlySpend: source.monthlySpend || '$2.4K',
      sessionToken: source.sessionToken || generateSessionToken(),
      selectedLayout: source.selectedLayout || null,
      selectedIndustry: source.selectedIndustry || null
    };
  }

  function requireCustomer(redirectTo) {
    const customer = getCustomer();
    if (!customer) {
      clearCustomer();
      if (redirectTo) window.location.href = redirectTo;
      return null;
    }
    if (isSupportLoggedIn()) {
      clearSupport();
    }
    localStorage.setItem('portalCustomer', JSON.stringify(customer));
    return customer;
  }

  function requireSupport(redirectTo) {
    const support = getSupport();
    if (!support) {
      clearSupport();
      if (redirectTo) window.location.href = redirectTo;
      return null;
    }
    if (isCustomerLoggedIn()) {
      clearCustomer();
    }
    localStorage.setItem('supportStaff', JSON.stringify(support));
    return support;
  }

  function redirectIfCustomer(redirectTo) {
    if (isCustomerLoggedIn() && redirectTo) {
      window.location.href = redirectTo;
      return true;
    }
    return false;
  }

  function redirectIfSupport(redirectTo) {
    if (isSupportLoggedIn() && redirectTo) {
      window.location.href = redirectTo;
      return true;
    }
    return false;
  }

  function logoutCustomer(redirectTo) {
    clearCustomer();
    if (redirectTo) window.location.href = redirectTo;
  }

  function logoutSupport(redirectTo) {
    clearSupport();
    if (redirectTo) window.location.href = redirectTo;
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
    getCustomer,
    getSupport,
    setCustomer,
    setSupport,
    clearCustomer,
    clearSupport,
    hasRegisteredAccounts,
    isCustomerLoggedIn,
    isSupportLoggedIn,
    isSupportAdmin,
    generateSessionToken,
    hashPasswordWithSalt,
    verifyPassword,
    buildCustomerSession,
    requireCustomer,
    requireSupport,
    redirectIfCustomer,
    redirectIfSupport,
    logoutCustomer,
    logoutSupport
  };
})();
