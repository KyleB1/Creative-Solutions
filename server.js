/**
 * server.js - Express.js server with Stripe integration
 * 
 * Quick Start:
 * 1. Install dependencies: npm install express stripe cors dotenv
 * 2. Set environment variables in .env
 * 3. Run: node server.js
 * 5. Server will be available at http://localhost:3000
 */

require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const path = require('path');
const logger = require('./logger');
const dataStore = require('./data-store');

// Initialize Express
const app = express();
const DEFAULT_PORT = 3000;
const requestedPort = Number(process.env.PORT || DEFAULT_PORT);
const isProduction = String(process.env.NODE_ENV || 'development').toLowerCase() === 'production';

function resolvePort(port) {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return DEFAULT_PORT;
  }
  return port;
}

function startServer(port) {
  const normalizedPort = resolvePort(port);
  const server = app.listen(normalizedPort, onListening.bind(null, normalizedPort));
  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${normalizedPort} is already in use. Please stop the conflicting process or set PORT to a different value.`);
      process.exit(1);
    } else {
      throw err;
    }
  });
  activeServer = server;
  return server;
}

app.disable('x-powered-by');
app.set('trust proxy', 1);

function getConfiguredOrigins() {
  return String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);
}

function normalizeOrigin(origin) {
  if (!origin) return '';
  const value = String(origin).trim();
  if (!value) return '';

  try {
    return new URL(value).origin;
  } catch (_error) {
    return value.replace(/\/+$/, '');
  }
}

function isLocalDevelopmentOrigin(origin) {
  if (!origin) return false;

  try {
    const parsed = new URL(origin);
    const hostname = String(parsed.hostname || '').toLowerCase();
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    return (hostname === 'localhost' || hostname === '127.0.0.1') && port === '3000';
  } catch (_error) {
    return false;
  }
}

function getAllowedOrigins(req) {
  const configuredOrigins = getConfiguredOrigins();
  const inferredOrigin = normalizeOrigin(`${req.protocol}://${req.get('host')}`);
  return new Set([
    inferredOrigin,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    ...configuredOrigins
  ]);
}

function isAllowedOrigin(requestOrigin, allowedOrigins) {
  return !requestOrigin
    || requestOrigin === 'null'
    || allowedOrigins.has(requestOrigin)
    || isLocalDevelopmentOrigin(requestOrigin);
}

function buildCorsOptions(req) {
  const allowedOrigins = getAllowedOrigins(req);
  const requestOrigin = normalizeOrigin(req.get('origin'));
  const allowed = isAllowedOrigin(requestOrigin, allowedOrigins);

  return {
    origin: allowed ? (requestOrigin || true) : false,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Token', 'X-Customer-Id', 'X-CWS-Session', 'X-CSRF-Token'],
    optionsSuccessStatus: 204
  };
}

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      // NOTE: Inline page scripts remain for now; externalizing them would allow
      // removing 'unsafe-inline' from scriptSrc and hardening CSP further.
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https://images.unsplash.com'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      connectSrc: ["'self'", 'https://creative-solutions.onrender.com', 'http://localhost:3000', 'http://127.0.0.1:3000']
    }
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: isProduction ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  } : false
}));

// CORS configuration
app.use((req, res, next) => {
  const requestOrigin = normalizeOrigin(req.get('origin'));
  const allowedOrigins = getAllowedOrigins(req);
  const allowed = isAllowedOrigin(requestOrigin, allowedOrigins);

  if (allowed && requestOrigin) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Admin-Token,X-Customer-Id,X-CWS-Session,X-CSRF-Token');
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

const CSRF_COOKIE_NAME = 'cws_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';

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

function appendSetCookie(res, cookieValue) {
  const current = res.getHeader('Set-Cookie');
  if (!current) {
    res.setHeader('Set-Cookie', cookieValue);
    return;
  }

  if (Array.isArray(current)) {
    res.setHeader('Set-Cookie', [...current, cookieValue]);
    return;
  }

  res.setHeader('Set-Cookie', [current, cookieValue]);
}

function serializeCsrfCookie(token) {
  const cookieParts = [
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.floor((1000 * 60 * 60 * 12) / 1000)}`
  ];

  if (isProduction) {
    cookieParts.push('Secure');
  }

  return cookieParts.join('; ');
}

function shouldEnforceBrowserCsrf(req) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return false;
  }

  if (req.path === '/billing/webhook') {
    return false;
  }

  const secFetchSite = String(req.get('sec-fetch-site') || '').trim();
  const secFetchMode = String(req.get('sec-fetch-mode') || '').trim();
  const origin = String(req.get('origin') || '').trim();
  const hasBrowserHints = Boolean(secFetchSite || secFetchMode || origin);

  // Keep non-browser API clients and test scripts working without a CSRF bootstrap call.
  return hasBrowserHints;
}

app.use('/api', (req, res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  const existingToken = String(cookies[CSRF_COOKIE_NAME] || '').trim();
  const csrfToken = existingToken || crypto.randomBytes(24).toString('hex');
  if (!existingToken) {
    appendSetCookie(res, serializeCsrfCookie(csrfToken));
  }

  if (!shouldEnforceBrowserCsrf(req)) {
    return next();
  }

  const requestToken = String(req.get(CSRF_HEADER_NAME) || '').trim();
  if (!requestToken || requestToken !== csrfToken) {
    return res.status(403).json({ error: 'CSRF token missing or invalid.' });
  }

  return next();
});

function parseRateLimitMax(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const PAYMENT_RATE_LIMIT_MAX = parseRateLimitMax(process.env.PAYMENT_RATE_LIMIT_MAX, isProduction ? 5 : 100);
const AUTH_RATE_LIMIT_MAX = parseRateLimitMax(process.env.AUTH_RATE_LIMIT_MAX, isProduction ? 10 : 200);
const CONTACT_RATE_LIMIT_MAX = parseRateLimitMax(process.env.CONTACT_RATE_LIMIT_MAX, isProduction ? 5 : 50);

// Rate limiting for payment endpoints
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: PAYMENT_RATE_LIMIT_MAX,
  message: { error: 'Too many payment attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${req.path}`
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: AUTH_RATE_LIMIT_MAX,
  message: { error: 'Too many authentication attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${req.path}`
});

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: CONTACT_RATE_LIMIT_MAX,
  message: { error: 'Too many contact submissions, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Stripe webhook requires the raw request body for signature verification.
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

// Body parsing
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    dataBackend: dataStore.backend
  });
});

// Stripe webhook (must be before express.json() middleware for raw body)
// This is handled in billing-routes.js with express.raw()

// API routes
const authRoutes = require('./auth-routes');
const { getActiveSession } = require('./auth-routes');
const billingRoutes = require('./billing-routes');
const contactRoutes = require('./contact-routes');

// Rate-limit only the mutating auth endpoints.
// Do NOT apply to GET /api/auth/session or GET /api/auth/meta;
// those are called on every page load and would exhaust the limit.
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/signup', authLimiter);
app.use('/api/auth/support-login', authLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/billing', paymentLimiter, billingRoutes);
app.use('/api/contact', contactLimiter, contactRoutes);

app.get(['/legal', '/legal.html'], (req, res) => {
  const session = getActiveSession(req);
  if (!session || !session.user || !(session.user.role === 'admin' || session.user.role === 'support')) {
    return res.status(403).send('Forbidden');
  }
  return res.sendFile(path.join(__dirname, 'legal.html'));
});

// Static files (if serving frontend from same server)
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return next();
  }

  const normalizedPath = path.posix.normalize(req.path || '/');
  const fileName = path.posix.basename(normalizedPath);
  const blockedNames = new Set([
    'server.js',
    'auth-routes.js',
    'billing-routes.js',
    'billing-backend.js',
    'stripe-config.js',
    'package.json',
    '.env',
    'contact-routes.js',
  ]);
  const blockedExtensions = new Set(['.sql', '.md', '.sh', '.cjs']);

  if (
    normalizedPath.startsWith('/api/') ||
    normalizedPath.startsWith('/data/') ||
    normalizedPath.startsWith('/scripts/') ||
    blockedNames.has(fileName) ||
    blockedExtensions.has(path.extname(fileName).toLowerCase())
  ) {
    return res.status(404).end();
  }

  next();
});

app.use(express.static(path.join(__dirname), {
  index: ['index.htm', 'index.html']
}));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Server error:', err);
  res.status(err.status || 500).json({
    error: err.status ? (err.message || 'Request failed') : 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// Track the active server instance so SIGTERM shutdown works correctly.
let activeServer = null;

async function onListening(port) {
  logger.info('\n╔════════════════════════════════════════════════════════════════╗');
  logger.info('║                   STRIPE PAYMENT SERVER                        ║');
  logger.info('╚════════════════════════════════════════════════════════════════╝\n');

  logger.info(`Server running on http://localhost:${port}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Mode: ${process.env.STRIPE_SECRET_KEY?.startsWith('sk_test') ? 'TEST' : 'LIVE'}\n`);
  logger.info(`Data backend: ${dataStore.backend}`);
  logger.info(`Customer store: ${process.env.CUSTOMER_STORE_PATH || path.join(__dirname, 'data', 'customer-accounts.json')}`);
  if (!process.env.SUPPORT_PORTAL_PASSWORD) {
    logger.warn('Support login disabled until SUPPORT_PORTAL_PASSWORD is configured.');
  }

  // Test Stripe connection
  try {
    const { testStripeConnection } = require('./stripe-config');
    const connected = await testStripeConnection();
    
    if (!connected) {
      logger.warn('⚠️  Warning: Stripe connection failed. Check your API keys in .env\n');
    }
  } catch (error) {
    logger.error('Error testing Stripe:', error.message);
  }

  logger.info('Available endpoints:');
  logger.info('  POST   /api/billing/payment-intent    - Create payment intent');
  logger.info('  POST   /api/billing/charge            - Process payment');
  logger.info('  POST   /api/billing/payment-methods   - Store payment method');
  logger.info('  GET    /api/billing/payment-methods   - List payment methods');
  logger.info('  DELETE /api/billing/payment-methods/:id - Delete payment method');
  logger.info('  GET    /api/billing/payments          - Payment history');
  logger.info('  POST   /api/billing/refund            - Refund (admin only)');
  logger.info('  POST   /api/billing/webhook           - Stripe webhook\n');
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  if (activeServer) {
    activeServer.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

startServer(requestedPort);

module.exports = app;
