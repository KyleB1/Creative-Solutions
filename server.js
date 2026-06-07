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
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const path = require('path');
const logger = require('./logger');

// Initialize Express
const app = express();
const DEFAULT_PORT = 3000;
const PORT = Number(process.env.PORT || DEFAULT_PORT);

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

function buildCorsOptions(req) {
  const configuredOrigins = getConfiguredOrigins();
  const inferredOrigin = normalizeOrigin(`${req.protocol}://${req.get('host')}`);
  const allowedOrigins = new Set([
    inferredOrigin,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://kyleb1.github.io',
    ...configuredOrigins
  ]);
  const requestOrigin = normalizeOrigin(req.get('origin'));
  const isAllowedOrigin = !requestOrigin
    || requestOrigin === 'null'
    || allowedOrigins.has(requestOrigin)
    || isLocalDevelopmentOrigin(requestOrigin);

  return {
    origin: isAllowedOrigin ? (requestOrigin || true) : false,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Token', 'X-Customer-Id'],
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
      imgSrc: ["'self'", 'data:', 'https://images.unsplash.com']
    }
  }
}));

// CORS configuration
app.use((req, res, next) => {
  const requestOrigin = normalizeOrigin(req.get('origin'));
  const configuredOrigins = getConfiguredOrigins();
  const inferredOrigin = normalizeOrigin(`${req.protocol}://${req.get('host')}`);
  const allowedOrigins = new Set([
    inferredOrigin,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://kyleb1.github.io',
    ...configuredOrigins
  ]);

  const isAllowedOrigin = !requestOrigin
    || requestOrigin === 'null'
    || allowedOrigins.has(requestOrigin)
    || isLocalDevelopmentOrigin(requestOrigin);

  if (isAllowedOrigin && requestOrigin) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Admin-Token,X-Customer-Id');
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

// Rate limiting for payment endpoints
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 5,  // 5 attempts per billing endpoint
  message: { error: 'Too many payment attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${req.path}`
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,  // 10 attempts per auth endpoint
  message: { error: 'Too many authentication attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${req.path}`
});

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
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
    environment: process.env.NODE_ENV || 'development'
  });
});

// Stripe webhook (must be before express.json() middleware for raw body)
// This is handled in billing-routes.js with express.raw()

// API routes
const authRoutes = require('./auth-routes');
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

// Start server on a single configured port and fail loudly if it is already in use.
function startServer(port) {
  const normalizedPort = Number(port);
  const s = app.listen(normalizedPort, onListening.bind(null, normalizedPort));
  s.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${normalizedPort} is already in use. Please free the port or set PORT to a different value before starting the server.`);
      process.exit(1);
    } else {
      throw err;
    }
  });
  activeServer = s;
  return s;
}

async function onListening(port) {
  logger.info('\n╔════════════════════════════════════════════════════════════════╗');
  logger.info('║                   STRIPE PAYMENT SERVER                        ║');
  logger.info('╚════════════════════════════════════════════════════════════════╝\n');

  logger.info(`Server running on http://localhost:${port}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Mode: ${process.env.STRIPE_SECRET_KEY?.startsWith('sk_test') ? 'TEST' : 'LIVE'}\n`);
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

startServer(PORT);

module.exports = app;
