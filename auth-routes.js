const express = require('express');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const router = express.Router();

const SESSION_COOKIE_NAME = 'cws_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const PBKDF2_ITERATIONS = 210000;
const PBKDF2_KEY_LENGTH = 64;
const PBKDF2_DIGEST = 'sha512';
const CUSTOMER_STORE_PATH = path.resolve(
  process.env.CUSTOMER_STORE_PATH || path.join(__dirname, 'data', 'customer-accounts.json')
);
const sessions = new Map();

const SUPPORT_ROLES = Object.freeze({
  'support@creativewebsolutions.com': 'Support Agent',
  'helpdesk@creativewebsolutions.com': 'Support Agent',
  'admin@creativewebsolutions.com': 'System Administrator',
  'kyle.creativesolutions@gmail.com': 'Support Administrator',
  'kyle.creativesolutins@gmail.com': 'System Administrator'
});

const DEFAULT_CUSTOMER_PROFILE = Object.freeze({
  role: 'customer',
  plan: 'Growth plan',
  renewal: 'May 18',
  activeProjects: 8,
  newLeads: 24,
  supportTickets: 3,
  monthlySpend: '$2.4K',
  notifications: false
});

router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeDisplayName(value, fallback) {
  const text = String(value || '').trim();
  if (text) {
    return text.replace(/\s+/g, ' ');
  }
  return fallback;
}

function validatePassword(password) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(String(password || ''));
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(
    String(password || ''),
    salt,
    PBKDF2_ITERATIONS,
    PBKDF2_KEY_LENGTH,
    PBKDF2_DIGEST
  ).toString('hex');
}

function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    salt,
    hash: hashPassword(password, salt)
  };
}

function verifyPassword(password, record) {
  if (!record || !record.salt || !record.hash) {
    return false;
  }
  const derived = hashPassword(password, record.salt);
  return safeEqual(derived, record.hash);
}

function parseCookies(headerValue) {
  return String(headerValue || '')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((accumulator, entry) => {
      const separatorIndex = entry.indexOf('=');
      if (separatorIndex === -1) {
        return accumulator;
      }
      const key = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      accumulator[key] = decodeURIComponent(value);
      return accumulator;
    }, {});
}

function serializeCookie(sessionId, maxAgeMs) {
  const cookieParts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`
  ];

  if (process.env.NODE_ENV === 'production') {
    cookieParts.push('Secure');
  }

  return cookieParts.join('; ');
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', serializeCookie('', 0));
}

async function ensureCustomerStore() {
  await fs.mkdir(path.dirname(CUSTOMER_STORE_PATH), { recursive: true });

  try {
    await fs.access(CUSTOMER_STORE_PATH);
  } catch (error) {
    await fs.writeFile(
      CUSTOMER_STORE_PATH,
      JSON.stringify({ customers: {} }, null, 2),
      'utf8'
    );
  }
}

async function readCustomerStore() {
  await ensureCustomerStore();
  const raw = await fs.readFile(CUSTOMER_STORE_PATH, 'utf8');
  const parsed = JSON.parse(raw || '{}');
  return parsed && typeof parsed === 'object' ? parsed : { customers: {} };
}

async function writeCustomerStore(store) {
  await ensureCustomerStore();
  await fs.writeFile(CUSTOMER_STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

function customerSessionView(customer) {
  if (!customer) {
    return null;
  }

  return {
    role: 'customer',
    email: customer.email,
    name: customer.name,
    plan: customer.plan,
    renewal: customer.renewal,
    activeProjects: customer.activeProjects,
    newLeads: customer.newLeads,
    supportTickets: customer.supportTickets,
    monthlySpend: customer.monthlySpend,
    notifications: Boolean(customer.notifications),
    customerId: customer.customerId || null
  };
}

function supportSessionView(email) {
  const normalizedEmail = normalizeEmail(email);
  const role = SUPPORT_ROLES[normalizedEmail] || null;
  if (!role) {
    return null;
  }

  return {
    role: role === 'System Administrator' ? 'admin' : 'support',
    email: normalizedEmail,
    name: normalizeDisplayName(normalizedEmail.split('@')[0].replace(/[^a-zA-Z0-9]+/g, ' '), 'Support Agent')
      .replace(/\b\w/g, (character) => character.toUpperCase()),
    supportRole: role
  };
}

function createSession(res, user) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;

  sessions.set(sessionId, {
    user,
    expiresAt
  });

  res.setHeader('Set-Cookie', serializeCookie(sessionId, SESSION_TTL_MS));
  return sessionId;
}

function destroySession(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE_NAME];
  if (sessionId) {
    sessions.delete(sessionId);
  }
  clearSessionCookie(res);
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (!session || session.expiresAt <= now) {
      sessions.delete(sessionId);
    }
  }
}

function getActiveSession(req) {
  pruneExpiredSessions();
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE_NAME];
  if (!sessionId) {
    return null;
  }

  const session = sessions.get(sessionId);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }

  return {
    sessionId,
    ...session
  };
}

function requireSessionRole(role) {
  return (req, res, next) => {
    const session = getActiveSession(req);
    if (!session || !session.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (session.user.role === 'admin' || session.user.role === role) {
      req.session = session;
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized' });
  };
}

function supportPasswordConfigured() {
  return Boolean(String(process.env.SUPPORT_PORTAL_PASSWORD || '').trim());
}

router.get('/meta', async (req, res, next) => {
  try {
    const store = await readCustomerStore();
    const customers = store.customers && typeof store.customers === 'object' ? store.customers : {};
    res.json({
      hasCustomerAccounts: Object.keys(customers).length > 0,
      supportLoginConfigured: supportPasswordConfigured()
    });
  } catch (error) {
    next(error);
  }
});

router.get('/session', (req, res) => {
  const session = getActiveSession(req);
  if (!session) {
    return res.json({ authenticated: false, user: null });
  }

  res.json({
    authenticated: true,
    user: session.user
  });
});

router.post('/signup', async (req, res, next) => {
  try {
    const name = normalizeDisplayName(req.body.name, 'Customer');
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.' });
    }

    if (SUPPORT_ROLES[email]) {
      return res.status(403).json({ error: 'Support accounts must use the secured support login flow.' });
    }

    const store = await readCustomerStore();
    const customers = store.customers && typeof store.customers === 'object' ? store.customers : {};

    if (customers[email]) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const passwordRecord = createPasswordRecord(password);
    const customer = {
      ...DEFAULT_CUSTOMER_PROFILE,
      customerId: crypto.randomUUID(),
      name,
      email,
      passwordSalt: passwordRecord.salt,
      passwordHash: passwordRecord.hash,
      createdAt: new Date().toISOString()
    };

    customers[email] = customer;
    store.customers = customers;
    await writeCustomerStore(store);

    destroySession(req, res);
    createSession(res, customerSessionView(customer));

    res.status(201).json({
      user: customerSessionView(customer)
    });
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const store = await readCustomerStore();
    const customer = store.customers && store.customers[email];
    if (!customer) {
      return res.status(401).json({ error: 'No account found for that email. Please sign up first.' });
    }

    if (!verifyPassword(password, { salt: customer.passwordSalt, hash: customer.passwordHash })) {
      return res.status(401).json({ error: 'Incorrect password. Please try again.' });
    }

    destroySession(req, res);
    createSession(res, customerSessionView(customer));

    res.json({
      user: customerSessionView(customer)
    });
  } catch (error) {
    next(error);
  }
});

router.post('/support-login', (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  const role = SUPPORT_ROLES[email] || null;
  const configuredPassword = String(process.env.SUPPORT_PORTAL_PASSWORD || '');

  if (!role) {
    return res.status(403).json({ error: 'Access denied. This account does not have support portal permissions.' });
  }

  if (!supportPasswordConfigured()) {
    return res.status(503).json({ error: 'Support login is disabled until SUPPORT_PORTAL_PASSWORD is configured on the server.' });
  }

  if (!password || !safeEqual(password, configuredPassword)) {
    return res.status(401).json({ error: 'Incorrect support password.' });
  }

  const supportUser = supportSessionView(email);
  destroySession(req, res);
  createSession(res, supportUser);

  res.json({
    user: supportUser
  });
});

router.patch('/customer-profile', requireSessionRole('customer'), async (req, res, next) => {
  try {
    const sessionUser = req.session.user;
    const name = normalizeDisplayName(req.body.name, sessionUser.name || 'Customer');
    const email = normalizeEmail(req.body.email || sessionUser.email);
    const plan = normalizeDisplayName(req.body.plan, sessionUser.plan || DEFAULT_CUSTOMER_PROFILE.plan);
    const notifications = Boolean(req.body.notifications);

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required.' });
    }

    const store = await readCustomerStore();
    const customers = store.customers && typeof store.customers === 'object' ? store.customers : {};
    const existing = customers[sessionUser.email];

    if (!existing) {
      destroySession(req, res);
      return res.status(401).json({ error: 'Session account no longer exists.' });
    }

    if (email !== sessionUser.email && customers[email]) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const updatedCustomer = {
      ...existing,
      name,
      email,
      plan,
      notifications
    };

    if (email !== sessionUser.email) {
      delete customers[sessionUser.email];
    }
    customers[email] = updatedCustomer;
    store.customers = customers;
    await writeCustomerStore(store);

    const updatedUser = customerSessionView(updatedCustomer);
    sessions.set(req.session.sessionId, {
      user: updatedUser,
      expiresAt: req.session.expiresAt
    });

    res.json({ user: updatedUser });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', (req, res) => {
  destroySession(req, res);
  res.status(204).send();
});

module.exports = router;
module.exports.getActiveSession = getActiveSession;