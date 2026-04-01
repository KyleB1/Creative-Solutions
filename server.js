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
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' }
}));

// CORS configuration
app.use(cors({
  origin: (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:3000').split(','),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Token', 'X-Customer-Id']
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

// Stripe webhook requires the raw request body for signature verification.
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

// Body parsing
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: true }));

// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);

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
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/billing', paymentLimiter, billingRoutes);

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
    '.env'
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
  res.status(404).json({
    error: 'Not found',
    path: req.path,
    method: req.method
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    timestamp: new Date().toISOString(),
    path: req.path
  });
});

// Start server
const server = app.listen(PORT, async () => {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                   STRIPE PAYMENT SERVER                        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Mode: ${process.env.STRIPE_SECRET_KEY?.startsWith('sk_test') ? 'TEST' : 'LIVE'}\n`);
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
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

module.exports = app;
