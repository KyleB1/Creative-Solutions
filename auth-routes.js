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
const ADMIN_STORE_PATH = path.resolve(
  process.env.ADMIN_STORE_PATH || path.join(__dirname, 'data', 'admin-state.json')
);
const sessions = new Map();

const SUPPORT_ROLES = Object.freeze({
  'support@creativewebsolutions.com': 'Support Agent',
  'helpdesk@creativewebsolutions.com': 'Support Agent',
  'admin@creativewebsolutions.com': 'System Administrator',
  'kyle.creativesolutions@gmail.com': 'System Administrator'
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

const DEFAULT_SUPPORT_TICKETS = Object.freeze([
  {
    id: 'TCK-1012',
    customer: 'Avery Francis',
    customerEmail: 'avery.francis@example.com',
    subject: 'Login not working',
    status: 'open',
    priority: 'High',
    createdAt: '2026-03-27T10:12:00.000Z',
    updatedAt: '2026-03-28T10:42:00.000Z',
    product: 'Client portal',
    description: 'Customer cannot access their account after password reset. They receive a generic error on login.',
    messages: [
      { id: 'msg-1012-1', author: 'Customer', visibility: 'customer', timestamp: '2026-03-27T10:12:00.000Z', content: 'The reset link keeps failing and I cannot sign in.' },
      { id: 'msg-1012-2', author: 'Agent', visibility: 'agent', timestamp: '2026-03-27T10:42:00.000Z', content: 'Checked the reset flow; looks like a token expiry issue. Need to patch the login handler.' }
    ]
  },
  {
    id: 'TCK-1009',
    customer: 'Mason Lee',
    customerEmail: 'mason.lee@example.com',
    subject: 'Invoice mismatch',
    status: 'pending',
    priority: 'Medium',
    createdAt: '2026-03-24T09:18:00.000Z',
    updatedAt: '2026-03-27T11:05:00.000Z',
    product: 'Billing dashboard',
    description: 'Invoice total does not match the contract price. Customer requests updated invoice and correction.',
    messages: [
      { id: 'msg-1009-1', author: 'Customer', visibility: 'customer', timestamp: '2026-03-24T09:18:00.000Z', content: 'The total on invoice #118 is higher than expected.' },
      { id: 'msg-1009-2', author: 'Agent', visibility: 'agent', timestamp: '2026-03-24T11:05:00.000Z', content: 'Reviewing line items and contract terms now.' }
    ]
  },
  {
    id: 'TCK-1004',
    customer: 'Jada Rivera',
    customerEmail: 'jada.rivera@example.com',
    subject: 'Website update request',
    status: 'resolved',
    priority: 'Low',
    createdAt: '2026-03-20T14:30:00.000Z',
    updatedAt: '2026-03-25T09:12:00.000Z',
    product: 'Website CMS',
    description: 'Customer requested a homepage hero image update and content tweak, completed successfully.',
    messages: [
      { id: 'msg-1004-1', author: 'Customer', visibility: 'customer', timestamp: '2026-03-20T14:30:00.000Z', content: 'Please update the hero image and CTA text to match new branding.' },
      { id: 'msg-1004-2', author: 'Agent', visibility: 'agent', timestamp: '2026-03-21T09:12:00.000Z', content: 'Implemented the requested content changes and published the page.' }
    ]
  },
  {
    id: 'TCK-1015',
    customer: 'Harper Wells',
    customerEmail: 'harper.wells@example.com',
    subject: 'Broken form submission',
    status: 'open',
    priority: 'High',
    createdAt: '2026-03-28T08:54:00.000Z',
    updatedAt: '2026-03-28T09:20:00.000Z',
    product: 'Contact form',
    description: 'Form submissions are failing with a 500 error. Customer needs urgent fix for lead capture.',
    messages: [
      { id: 'msg-1015-1', author: 'Customer', visibility: 'customer', timestamp: '2026-03-28T08:54:00.000Z', content: 'My form is returning an error after submit and leads are not getting captured.' },
      { id: 'msg-1015-2', author: 'Agent', visibility: 'agent', timestamp: '2026-03-28T09:20:00.000Z', content: 'Investigating server error logs and validation rules.' }
    ]
  }
]);

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

function cloneDefaultSupportTickets() {
  return JSON.parse(JSON.stringify(DEFAULT_SUPPORT_TICKETS));
}

function getDefaultAdminStore() {
  return {
    supportSettings: {
      passwordSalt: null,
      passwordHash: null,
      updatedAt: null,
      updatedBy: null
    },
    supportTickets: cloneDefaultSupportTickets(),
    auditLog: []
  };
}

function normalizeAdminStore(store) {
  const defaults = getDefaultAdminStore();
  const normalized = store && typeof store === 'object' ? store : {};
  return {
    supportSettings: {
      ...defaults.supportSettings,
      ...(normalized.supportSettings && typeof normalized.supportSettings === 'object' ? normalized.supportSettings : {})
    },
    supportTickets: Array.isArray(normalized.supportTickets) ? normalized.supportTickets : defaults.supportTickets,
    auditLog: Array.isArray(normalized.auditLog) ? normalized.auditLog : defaults.auditLog
  };
}

async function ensureAdminStore() {
  await fs.mkdir(path.dirname(ADMIN_STORE_PATH), { recursive: true });

  try {
    await fs.access(ADMIN_STORE_PATH);
  } catch (error) {
    await fs.writeFile(ADMIN_STORE_PATH, JSON.stringify(getDefaultAdminStore(), null, 2), 'utf8');
  }
}

async function readAdminStore() {
  await ensureAdminStore();
  const raw = await fs.readFile(ADMIN_STORE_PATH, 'utf8');
  const parsed = JSON.parse(raw || '{}');
  return normalizeAdminStore(parsed);
}

async function writeAdminStore(store) {
  await ensureAdminStore();
  await fs.writeFile(ADMIN_STORE_PATH, JSON.stringify(normalizeAdminStore(store), null, 2), 'utf8');
}

function getSupportPasswordRecord(store) {
  const settings = store && store.supportSettings;
  if (!settings || !settings.passwordSalt || !settings.passwordHash) {
    return null;
  }
  return {
    salt: settings.passwordSalt,
    hash: settings.passwordHash
  };
}

function createAuditEntry(event) {
  return {
    id: crypto.randomUUID(),
    action: event.action,
    title: event.title,
    description: event.description,
    actorEmail: event.actorEmail || null,
    actorName: event.actorName || null,
    actorRole: event.actorRole || null,
    targetType: event.targetType || null,
    targetId: event.targetId || null,
    createdAt: event.createdAt || new Date().toISOString()
  };
}

async function appendAuditEvent(event) {
  const store = await readAdminStore();
  const entry = createAuditEntry(event);
  store.auditLog.unshift(entry);
  store.auditLog = store.auditLog.slice(0, 250);
  await writeAdminStore(store);
  return entry;
}

function updateCustomerSessions(email, user) {
  for (const [sessionId, session] of sessions.entries()) {
    if (session && session.user && session.user.role === 'customer' && session.user.email === email) {
      sessions.set(sessionId, {
        ...session,
        user: customerSessionView(user)
      });
    }
  }
}

function getTicketStatusLabel(status) {
  switch (status) {
    case 'inprogress':
      return 'In progress';
    case 'waiting':
      return 'Waiting';
    case 'pending':
      return 'Pending';
    case 'resolved':
      return 'Resolved';
    default:
      return 'Open';
  }
}

function normalizeTicketRecord(ticket) {
  return {
    id: ticket.id,
    customer: ticket.customer,
    customerEmail: ticket.customerEmail || null,
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    product: ticket.product,
    description: ticket.description,
    messages: Array.isArray(ticket.messages) ? ticket.messages : []
  };
}

function createTicketId(existingTickets) {
  const highest = (existingTickets || []).reduce((maxId, ticket) => {
    const match = String(ticket.id || '').match(/^TCK-(\d+)$/);
    const value = match ? Number(match[1]) : 0;
    return Math.max(maxId, value);
  }, 1000);
  return `TCK-${highest + 1}`;
}

async function syncCustomerTicketCounts(adminStore, customerStore) {
  const customers = customerStore.customers && typeof customerStore.customers === 'object' ? customerStore.customers : {};
  const ticketCounts = (adminStore.supportTickets || []).reduce((counts, ticket) => {
    const email = normalizeEmail(ticket.customerEmail);
    if (email) {
      counts[email] = (counts[email] || 0) + 1;
    }
    return counts;
  }, {});

  Object.values(customers).forEach((customer) => {
    const email = normalizeEmail(customer.email);
    customer.supportTickets = ticketCounts[email] || 0;
    updateCustomerSessions(email, customer);
  });

  customerStore.customers = customers;
  await writeCustomerStore(customerStore);
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

function supportPasswordConfigured(store) {
  return Boolean(getSupportPasswordRecord(store) || String(process.env.SUPPORT_PORTAL_PASSWORD || '').trim());
}

function verifySupportPassword(password, store) {
  const record = getSupportPasswordRecord(store);
  if (record) {
    return verifyPassword(password, record);
  }
  const configuredPassword = String(process.env.SUPPORT_PORTAL_PASSWORD || '');
  return Boolean(password) && safeEqual(password, configuredPassword);
}

function formatSessionUser(sessionId, user, expiresAt) {
  if (!user) {
    return null;
  }

  return {
    sessionId,
    email: user.email || null,
    name: user.name || null,
    role: user.role || null,
    supportRole: user.supportRole || null,
    plan: user.plan || null,
    expiresAt: new Date(expiresAt).toISOString()
  };
}

async function buildAdminOverview() {
  pruneExpiredSessions();

  const customerStore = await readCustomerStore();
  const adminStore = await readAdminStore();
  const customers = customerStore.customers && typeof customerStore.customers === 'object' ? Object.values(customerStore.customers) : [];
  const activeSessions = Array.from(sessions.entries())
    .filter(([, session]) => session && session.user && session.expiresAt > Date.now())
    .map(([sessionId, session]) => formatSessionUser(sessionId, session.user, session.expiresAt))
    .filter(Boolean)
    .sort((left, right) => new Date(right.expiresAt) - new Date(left.expiresAt));

  const supportRoster = Object.entries(SUPPORT_ROLES).map(([email, supportRole]) => {
    const activeSession = activeSessions.find((session) => session.email === email);
    return {
      email,
      supportRole,
      isOnline: Boolean(activeSession),
      activeUntil: activeSession ? activeSession.expiresAt : null
    };
  });

  const customerRecords = customers
    .map((customer) => ({
      customerId: customer.customerId || null,
      name: customer.name || 'Customer',
      email: customer.email || null,
      plan: customer.plan || DEFAULT_CUSTOMER_PROFILE.plan,
      createdAt: customer.createdAt || null,
      renewal: customer.renewal || null,
      activeProjects: Number(customer.activeProjects || 0),
      newLeads: Number(customer.newLeads || 0),
      supportTickets: Number(customer.supportTickets || 0),
      monthlySpend: customer.monthlySpend || '$0',
      notifications: Boolean(customer.notifications)
    }))
    .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));

  const supportTickets = adminStore.supportTickets
    .map((ticket) => normalizeTicketRecord(ticket))
    .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0));

  const auditLog = adminStore.auditLog
    .slice(0, 20)
    .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));

  const ticketCounts = supportTickets.reduce((counts, ticket) => {
    counts[ticket.status] = (counts[ticket.status] || 0) + 1;
    return counts;
  }, { open: 0, inprogress: 0, waiting: 0, pending: 0, resolved: 0 });

  return {
    generatedAt: new Date().toISOString(),
    supportLoginConfigured: supportPasswordConfigured(adminStore),
    supportPasswordUpdatedAt: adminStore.supportSettings.updatedAt || null,
    totals: {
      customers: customerRecords.length,
      activeSessions: activeSessions.length,
      activeCustomerSessions: activeSessions.filter((session) => session.role === 'customer').length,
      activeSupportSessions: activeSessions.filter((session) => session.role === 'support' || session.role === 'admin').length,
      adminSessions: activeSessions.filter((session) => session.role === 'admin').length,
      onlineSupportAccounts: supportRoster.filter((account) => account.isOnline).length,
      supportTickets: supportTickets.length,
      activeProjects: customerRecords.reduce((total, customer) => total + customer.activeProjects, 0),
      openTickets: ticketCounts.open,
      pendingTickets: ticketCounts.pending,
      resolvedTickets: ticketCounts.resolved
    },
    supportRoster,
    activeSessions,
    customers: customerRecords,
    supportTickets,
    auditLog
  };
}

router.get('/meta', async (req, res, next) => {
  try {
    const store = await readCustomerStore();
    const adminStore = await readAdminStore();
    const customers = store.customers && typeof store.customers === 'object' ? store.customers : {};
    res.json({
      hasCustomerAccounts: Object.keys(customers).length > 0,
      supportLoginConfigured: supportPasswordConfigured(adminStore)
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

router.get('/admin/overview', requireSessionRole('admin'), async (req, res, next) => {
  try {
    const overview = await buildAdminOverview();
    res.json({
      ...overview,
      currentSessionId: req.session.sessionId
    });
  } catch (error) {
    next(error);
  }
});

router.get('/customer/tickets', requireSessionRole('customer'), async (req, res, next) => {
  try {
    const adminStore = await readAdminStore();
    const customerEmail = normalizeEmail(req.session.user.email);
    const tickets = adminStore.supportTickets
      .filter((ticket) => normalizeEmail(ticket.customerEmail) === customerEmail)
      .map((ticket) => normalizeTicketRecord(ticket))
      .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0));
    res.json({ tickets });
  } catch (error) {
    next(error);
  }
});

router.post('/customer/tickets', requireSessionRole('customer'), async (req, res, next) => {
  try {
    const subject = normalizeDisplayName(req.body.subject, '');
    const product = normalizeDisplayName(req.body.product, 'General support');
    const description = String(req.body.description || '').trim();
    const priority = normalizeDisplayName(req.body.priority, 'Medium');
    const validPriorities = ['Low', 'Medium', 'High'];

    if (!subject || !description) {
      return res.status(400).json({ error: 'Subject and description are required.' });
    }
    if (!validPriorities.includes(priority)) {
      return res.status(400).json({ error: 'Invalid ticket priority.' });
    }

    const adminStore = await readAdminStore();
    const customerStore = await readCustomerStore();
    const ticketId = createTicketId(adminStore.supportTickets);
    const timestamp = new Date().toISOString();
    const ticket = {
      id: ticketId,
      customer: req.session.user.name || 'Customer',
      customerEmail: req.session.user.email,
      subject,
      status: 'open',
      priority,
      createdAt: timestamp,
      updatedAt: timestamp,
      product,
      description,
      messages: [
        {
          id: crypto.randomUUID(),
          author: req.session.user.name || 'Customer',
          visibility: 'customer',
          timestamp,
          content: description
        }
      ]
    };

    adminStore.supportTickets.push(ticket);
    await writeAdminStore(adminStore);
    await syncCustomerTicketCounts(adminStore, customerStore);
    await appendAuditEvent({
      action: 'customer.ticket.created',
      title: `${ticket.subject} submitted`,
      description: `${req.session.user.email} created ${ticket.id} for ${product}.`,
      actorEmail: req.session.user.email,
      actorName: req.session.user.name,
      actorRole: 'customer',
      targetType: 'ticket',
      targetId: ticket.id,
      createdAt: timestamp
    });

    const refreshedCustomerStore = await readCustomerStore();
    const updatedCustomer = refreshedCustomerStore.customers[req.session.user.email];
    if (updatedCustomer && req.session.sessionId) {
      sessions.set(req.session.sessionId, {
        user: customerSessionView(updatedCustomer),
        expiresAt: req.session.expiresAt
      });
    }

    res.status(201).json({
      ticket: normalizeTicketRecord(ticket),
      user: updatedCustomer ? customerSessionView(updatedCustomer) : req.session.user
    });
  } catch (error) {
    next(error);
  }
});

router.get('/support/tickets', requireSessionRole('support'), async (req, res, next) => {
  try {
    const adminStore = await readAdminStore();
    const tickets = adminStore.supportTickets
      .map((ticket) => normalizeTicketRecord(ticket))
      .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0));
    res.json({ tickets });
  } catch (error) {
    next(error);
  }
});

router.patch('/support/tickets/:ticketId', requireSessionRole('support'), async (req, res, next) => {
  try {
    const adminStore = await readAdminStore();
    const ticket = adminStore.supportTickets.find((entry) => entry.id === req.params.ticketId);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    const nextStatus = req.body.status ? String(req.body.status).trim().toLowerCase() : ticket.status;
    const nextPriority = req.body.priority ? normalizeDisplayName(req.body.priority, ticket.priority) : ticket.priority;
    const validStatuses = ['open', 'inprogress', 'waiting', 'pending', 'resolved'];
    const validPriorities = ['Low', 'Medium', 'High'];

    if (!validStatuses.includes(nextStatus)) {
      return res.status(400).json({ error: 'Invalid ticket status.' });
    }
    if (!validPriorities.includes(nextPriority)) {
      return res.status(400).json({ error: 'Invalid ticket priority.' });
    }

    const changes = [];
    if (ticket.status !== nextStatus) {
      changes.push(`status changed to ${getStatusLabel(nextStatus)}`);
      ticket.status = nextStatus;
    }
    if (ticket.priority !== nextPriority) {
      changes.push(`priority changed to ${nextPriority}`);
      ticket.priority = nextPriority;
    }

    ticket.updatedAt = new Date().toISOString();
    if (changes.length > 0) {
      ticket.messages.push({
        id: crypto.randomUUID(),
        author: 'Internal Note',
        visibility: 'internal',
        timestamp: ticket.updatedAt,
        content: `${changes.join(' and ')} by ${req.session.user.name || req.session.user.email}.`
      });
    }

    await writeAdminStore(adminStore);
    if (changes.length > 0) {
      await appendAuditEvent({
        action: 'ticket.updated',
        title: `Ticket ${ticket.id} updated`,
        description: `${ticket.subject} ${changes.join(' and ')}.`,
        actorEmail: req.session.user.email,
        actorName: req.session.user.name,
        actorRole: req.session.user.supportRole || req.session.user.role,
        targetType: 'ticket',
        targetId: ticket.id
      });
    }

    res.json({ ticket: normalizeTicketRecord(ticket) });
  } catch (error) {
    next(error);
  }
});

router.post('/support/tickets/:ticketId/messages', requireSessionRole('support'), async (req, res, next) => {
  try {
    const adminStore = await readAdminStore();
    const ticket = adminStore.supportTickets.find((entry) => entry.id === req.params.ticketId);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    const content = String(req.body.content || '').trim();
    const visibility = String(req.body.visibility || 'internal').trim().toLowerCase();
    if (!content) {
      return res.status(400).json({ error: 'Message content is required.' });
    }
    if (!['internal', 'customer', 'agent'].includes(visibility)) {
      return res.status(400).json({ error: 'Invalid message visibility.' });
    }

    const timestamp = new Date().toISOString();
    const author = visibility === 'customer' ? (req.session.user.name || 'Agent') : (req.session.user.name || req.session.user.email || 'Internal Note');
    ticket.messages.push({
      id: crypto.randomUUID(),
      author,
      visibility,
      timestamp,
      content
    });
    ticket.updatedAt = timestamp;

    await writeAdminStore(adminStore);
    await appendAuditEvent({
      action: 'ticket.message.added',
      title: `Message added to ${ticket.id}`,
      description: `${visibility === 'internal' ? 'Internal note' : 'Customer reply'} added on ${ticket.subject}.`,
      actorEmail: req.session.user.email,
      actorName: req.session.user.name,
      actorRole: req.session.user.supportRole || req.session.user.role,
      targetType: 'ticket',
      targetId: ticket.id
    });

    res.status(201).json({ ticket: normalizeTicketRecord(ticket) });
  } catch (error) {
    next(error);
  }
});

router.post('/admin/sessions/:sessionId/revoke', requireSessionRole('admin'), async (req, res, next) => {
  try {
    const targetSession = sessions.get(req.params.sessionId);
    if (!targetSession) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    const targetUser = targetSession.user || {};
    sessions.delete(req.params.sessionId);
    await appendAuditEvent({
      action: 'session.revoked',
      title: 'Session revoked by admin',
      description: `${targetUser.email || 'Unknown user'} session was revoked from the admin console.`,
      actorEmail: req.session.user.email,
      actorName: req.session.user.name,
      actorRole: req.session.user.supportRole || req.session.user.role,
      targetType: 'session',
      targetId: req.params.sessionId
    });

    res.json({ revoked: true, sessionId: req.params.sessionId });
  } catch (error) {
    next(error);
  }
});

router.patch('/admin/customers/:email', requireSessionRole('admin'), async (req, res, next) => {
  try {
    const customerEmail = normalizeEmail(req.params.email);
    const store = await readCustomerStore();
    const customers = store.customers && typeof store.customers === 'object' ? store.customers : {};
    const existing = customers[customerEmail];
    if (!existing) {
      return res.status(404).json({ error: 'Customer account not found.' });
    }

    const nextPlan = normalizeDisplayName(req.body.plan, existing.plan || DEFAULT_CUSTOMER_PROFILE.plan);
    const nextNotifications = req.body.notifications == null ? Boolean(existing.notifications) : Boolean(req.body.notifications);
    const nextName = normalizeDisplayName(req.body.name, existing.name || 'Customer');

    const updatedCustomer = {
      ...existing,
      name: nextName,
      plan: nextPlan,
      notifications: nextNotifications
    };

    customers[customerEmail] = updatedCustomer;
    store.customers = customers;
    await writeCustomerStore(store);
    updateCustomerSessions(customerEmail, updatedCustomer);
    await appendAuditEvent({
      action: 'customer.updated',
      title: `${updatedCustomer.name} account updated`,
      description: `Plan set to ${nextPlan} and notifications ${nextNotifications ? 'enabled' : 'disabled'}.`,
      actorEmail: req.session.user.email,
      actorName: req.session.user.name,
      actorRole: req.session.user.supportRole || req.session.user.role,
      targetType: 'customer',
      targetId: customerEmail
    });

    res.json({ user: customerSessionView(updatedCustomer) });
  } catch (error) {
    next(error);
  }
});

router.post('/admin/support-password', requireSessionRole('admin'), async (req, res, next) => {
  try {
    const password = String(req.body.password || '');
    if (!validatePassword(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.' });
    }

    const adminStore = await readAdminStore();
    const passwordRecord = createPasswordRecord(password);
    adminStore.supportSettings = {
      passwordSalt: passwordRecord.salt,
      passwordHash: passwordRecord.hash,
      updatedAt: new Date().toISOString(),
      updatedBy: req.session.user.email || null
    };
    await writeAdminStore(adminStore);
    await appendAuditEvent({
      action: 'support.password.rotated',
      title: 'Support password rotated',
      description: 'The support portal password was rotated from the admin console.',
      actorEmail: req.session.user.email,
      actorName: req.session.user.name,
      actorRole: req.session.user.supportRole || req.session.user.role,
      targetType: 'support-settings',
      targetId: 'support-password'
    });

    res.json({ success: true, updatedAt: adminStore.supportSettings.updatedAt });
  } catch (error) {
    next(error);
  }
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
    await appendAuditEvent({
      action: 'customer.signup',
      title: `${customer.name} created an account`,
      description: `${customer.email} signed up for the ${customer.plan} plan.`,
      actorEmail: customer.email,
      actorName: customer.name,
      actorRole: 'customer',
      targetType: 'customer',
      targetId: customer.email,
      createdAt: customer.createdAt
    });

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
    await appendAuditEvent({
      action: 'customer.login',
      title: `${customer.name} signed in`,
      description: `${customer.email} started a customer session.`,
      actorEmail: customer.email,
      actorName: customer.name,
      actorRole: 'customer',
      targetType: 'customer',
      targetId: customer.email
    });

    res.json({
      user: customerSessionView(customer)
    });
  } catch (error) {
    next(error);
  }
});

router.post('/support-login', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const role = SUPPORT_ROLES[email] || null;
    const adminStore = await readAdminStore();

    if (!role) {
      return res.status(403).json({ error: 'Access denied. This account does not have support portal permissions.' });
    }

    if (!supportPasswordConfigured(adminStore)) {
      return res.status(503).json({ error: 'Support login is disabled until SUPPORT_PORTAL_PASSWORD is configured on the server.' });
    }

    if (!verifySupportPassword(password, adminStore)) {
      return res.status(401).json({ error: 'Incorrect support password.' });
    }

    const supportUser = supportSessionView(email);
    destroySession(req, res);
    createSession(res, supportUser);
    await appendAuditEvent({
      action: 'support.login',
      title: `${supportUser.name} signed in`,
      description: `${supportUser.supportRole} session started for ${supportUser.email}.`,
      actorEmail: supportUser.email,
      actorName: supportUser.name,
      actorRole: supportUser.supportRole,
      targetType: 'support-user',
      targetId: supportUser.email
    });

    res.json({
      user: supportUser
    });
  } catch (error) {
    next(error);
  }
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
    await appendAuditEvent({
      action: 'customer.profile.updated',
      title: `${updatedCustomer.name} updated their profile`,
      description: `Profile settings were updated for ${updatedCustomer.email}.`,
      actorEmail: updatedCustomer.email,
      actorName: updatedCustomer.name,
      actorRole: 'customer',
      targetType: 'customer',
      targetId: updatedCustomer.email
    });

    res.json({ user: updatedUser });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const session = getActiveSession(req);
    if (session && session.user) {
      await appendAuditEvent({
        action: 'session.logout',
        title: `${session.user.name || session.user.email} logged out`,
        description: `${session.user.email || 'Unknown user'} ended their session.`,
        actorEmail: session.user.email || null,
        actorName: session.user.name || null,
        actorRole: session.user.supportRole || session.user.role || null,
        targetType: 'session',
        targetId: session.sessionId
      });
    }
    destroySession(req, res);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
module.exports.getActiveSession = getActiveSession;