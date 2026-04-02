/**
 * server.js - Express.js server with Stripe integration
 * 
 * Quick Start:
 * 1. Install dependencies: npm install express stripe cors dotenv
 * 2. Set environment variables in .env
 * 3. Run: node server.js
 * 4. Server will be available at http://localhost:3000
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const path = require('path');

// Initialize Express
const app = express();
const PORT = Number(process.env.PORT) || 3000;

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
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch (_error) {
    return false;
  }
}

function buildCorsOptions(req) {
  const configuredOrigins = getConfiguredOrigins();
  const inferredOrigin = normalizeOrigin(`${req.protocol}://${req.get('host')}`);
  const allowedOrigins = new Set([
    inferredOrigin,
    'http://localhost:3100',
    'http://127.0.0.1:3100',
    'http://localhost:3000',
    'https://kyleb1.github.io',
    ...configuredOrigins
  ]);
  const requestOrigin = normalizeOrigin(req.get('origin'));
  const isAllowedOrigin = !requestOrigin
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
      // TODO: migrate all page inline <script> blocks to external files, then
      // remove 'unsafe-inline' from scriptSrc to complete the CSP hardening.
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", 'https:', "'unsafe-inline'"]
    }
  }
}));

// CORS configuration
app.use(cors((req, callback) => {
  callback(null, buildCorsOptions(req));
}));
app.options('*', cors((req, callback) => {
  callback(null, buildCorsOptions(req));
}));

// Rate limiting for payment endpoints
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 5,  // 5 attempts
  message: { error: 'Too many payment attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many authentication attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
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
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
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
  console.error('Server error:', err);
  res.status(err.status || 500).json({
    error: err.status ? (err.message || 'Request failed') : 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// Track the active server instance so SIGTERM shutdown works correctly.
let activeServer = null;

// Start server — auto-increment port if the preferred one is already in use
function startServer(port) {
  const normalizedPort = Number(port);
  const s = app.listen(normalizedPort, onListening.bind(null, normalizedPort));
  s.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${normalizedPort} in use, trying ${normalizedPort + 1}…`);
      startServer(normalizedPort + 1);
    } else {
      throw err;
    }
  });
  activeServer = s;
  return s;
}

async function onListening(port) {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                   STRIPE PAYMENT SERVER                        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  
  console.log(`Server running on http://localhost:${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Mode: ${process.env.STRIPE_SECRET_KEY?.startsWith('sk_test') ? 'TEST' : 'LIVE'}\n`);
  console.log(`Customer store: ${process.env.CUSTOMER_STORE_PATH || path.join(__dirname, 'data', 'customer-accounts.json')}`);
  if (!process.env.SUPPORT_PORTAL_PASSWORD) {
    console.warn('Support login disabled until SUPPORT_PORTAL_PASSWORD is configured.');
  }

  // Test Stripe connection
  try {
    const { testStripeConnection } = require('./stripe-config');
    const connected = await testStripeConnection();
    
    if (!connected) {
      console.warn('⚠️  Warning: Stripe connection failed. Check your API keys in .env\n');
    }
  } catch (error) {
    console.error('Error testing Stripe:', error.message);
  }

  console.log('Available endpoints:');
  console.log('  POST   /api/billing/payment-intent    - Create payment intent');
  console.log('  POST   /api/billing/charge            - Process payment');
  console.log('  POST   /api/billing/payment-methods   - Store payment method');
  console.log('  GET    /api/billing/payment-methods   - List payment methods');
  console.log('  DELETE /api/billing/payment-methods/:id - Delete payment method');
  console.log('  GET    /api/billing/payments          - Payment history');
  console.log('  POST   /api/billing/refund            - Refund (admin only)');
  console.log('  POST   /api/billing/webhook           - Stripe webhook\n');
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  if (activeServer) {
    activeServer.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

startServer(PORT);

module.exports = app;
