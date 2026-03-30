/**
 * billing-routes.js - Express routes for Stripe payment processing
 * 
 * Endpoints:
 * POST   /api/billing/payment-intent    - Create payment intent
 * POST   /api/billing/charge            - Process payment
 * POST   /api/billing/payment-methods   - Store payment method
 * GET    /api/billing/payment-methods   - List payment methods
 * DELETE /api/billing/payment-methods/:id - Delete payment method
 * GET    /api/billing/payments          - Payment history
 * POST   /api/billing/refund            - Refund payment
 * POST   /api/billing/webhook           - Stripe webhook
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { stripe, formatAmountForStripe, translateStripeError } = require('./stripe-config');

function parseJwtClaims(token) {
  if (!token || token.split('.').length < 2) return null;

  try {
    const payloadSegment = token.split('.')[1];
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const payload = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(payload);
  } catch (error) {
    return null;
  }
}

/**
 * Verify an HS256 JWT signature using BILLING_JWT_SECRET env var.
 * Returns the decoded claims only if the signature is valid.
 * Returns null if the secret is not configured or verification fails.
 */
function verifyJwtClaims(token) {
  const secret = process.env.BILLING_JWT_SECRET;
  if (!secret) return null; // No secret configured — don't trust JWT role claims

  const parts = token && token.split('.');
  if (!parts || parts.length !== 3) return null;

  try {
    const signingInput = `${parts[0]}.${parts[1]}`;
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(signingInput)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    if (expectedSig !== parts[2]) return null;

    return parseJwtClaims(token);
  } catch (error) {
    return null;
  }
}

/**
 * Middleware: Verify customer authentication
 */
const requireAuth = (req, res, next) => {
  const authHeader = req.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Authorization required' });
  }

  const claims = parseJwtClaims(token);
  const tokenCustomerId = claims && typeof claims.sub === 'string' ? claims.sub : null;
  const requestCustomerId = req.body.customerId || req.query.customerId || req.get('X-Customer-Id');

  if (tokenCustomerId && requestCustomerId && tokenCustomerId !== requestCustomerId) {
    return res.status(403).json({ error: 'Customer mismatch for authenticated session' });
  }

  req.customerId = tokenCustomerId || requestCustomerId;
  req.authClaims = claims || null;
  
  if (!req.customerId) {
    return res.status(401).json({ error: 'Customer ID required' });
  }

  next();
};

/**
 * Middleware: Verify admin access for sensitive operations (refunds, etc).
 *
 * Two accepted paths:
 *  1. A JWT signed with BILLING_JWT_SECRET containing role: system_admin|support_admin|admin
 *  2. X-Admin-Token header matching the ADMIN_TOKEN env variable
 *
 * Unsigned JWT role claims are rejected to prevent privilege escalation.
 */
const requireAdmin = (req, res, next) => {
  const authHeader = req.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '');

  // Only accept role claims from a properly signed JWT
  const claims = verifyJwtClaims(token);
  if (claims && (claims.role === 'support_admin' || claims.role === 'admin' || claims.role === 'system_admin')) {
    req.authClaims = claims;
    return next();
  }

  // Fallback: static admin token from environment
  const adminToken = req.get('X-Admin-Token');
  if (process.env.ADMIN_TOKEN && adminToken === process.env.ADMIN_TOKEN) {
    return next();
  }

  return res.status(403).json({ error: 'Admin access required' });
};

/**
 * POST /api/billing/payment-intent
 * Create a payment intent for frontend Stripe.js
 * 
 * Body:
 *   - customerId: string (customer UUID)
 *   - amount: number (in dollars, e.g., 99.99)
 *   - currency: string (ISO 4217 code, e.g., 'USD')
 *   - description: string (optional, payment description)
 */
router.post('/payment-intent', requireAuth, async (req, res) => {
  try {
    const { amount, currency = 'USD', description } = req.body;
    const customerId = req.customerId;

    // Validate request
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: formatAmountForStripe(amount, currency),
      currency: currency.toLowerCase(),
      description: description || `Payment from ${customerId}`,
      metadata: {
        customerId,
        timestamp: new Date().toISOString()
      }
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount,
      currency
    });
  } catch (error) {
    console.error('Payment intent error:', error);
    res.status(500).json({ error: translateStripeError(error) });
  }
});

/**
 * POST /api/billing/charge
 * Process payment with a stored or tokenized payment method
 * 
 * Body:
 *   - customerId: string (customer UUID)
 *   - paymentMethodId: string (payment method ID or card token)
 *   - amount: number (in dollars)
 *   - currency: string (ISO 4217 code)
 *   - idempotencyKey: string (unique key to prevent duplicates)
 *   - email: string (optional, for receipt)
 */
router.post('/charge', requireAuth, async (req, res) => {
  try {
    const {
      paymentMethodId,
      amount,
      currency = 'USD',
      idempotencyKey,
      email,
      description
    } = req.body;
    const customerId = req.customerId;

    // Validate required fields
    if (!paymentMethodId) {
      return res.status(400).json({ error: 'Payment method ID required' });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    if (!idempotencyKey) {
      return res.status(400).json({ error: 'Idempotency key required' });
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: formatAmountForStripe(amount, currency),
        currency: currency.toLowerCase(),
        payment_method: paymentMethodId,
        confirm: true,
        description: description || `Payment from ${customerId}`,
        receipt_email: email,
        metadata: {
          customerId,
          timestamp: new Date().toISOString()
        }
      },
      {
        idempotencyKey // Prevent duplicate charges
      }
    );

    // Check payment status
    if (paymentIntent.status === 'succeeded') {
      const charge = paymentIntent.charges.data[0];
      
      res.json({
        success: true,
        paymentId: paymentIntent.id,
        transactionReference: charge?.id,
        amount,
        currency,
        receiptUrl: charge?.receipt_url,
        email: charge?.receipt_email
      });
    } else if (paymentIntent.status === 'requires_action') {
      // 3D Secure or similar authentication required
      res.status(202).json({
        success: false,
        requiresAction: true,
        error: 'Additional authentication required',
        clientSecret: paymentIntent.client_secret,
        status: 'requires_action'
      });
    } else if (paymentIntent.status === 'processing') {
      res.status(202).json({
        success: false,
        error: 'Payment is processing. Please check back in a moment.',
        status: 'processing'
      });
    } else {
      res.status(402).json({
        success: false,
        error: `Payment failed with status: ${paymentIntent.status}`,
        status: paymentIntent.status
      });
    }
  } catch (error) {
    console.error('Charge error:', error);
    
    // Handle specific Stripe errors
    if (error.type === 'StripeCardError') {
      return res.status(402).json({
        success: false,
        error: translateStripeError(error),
        code: error.code
      });
    }

    res.status(500).json({
      success: false,
      error: translateStripeError(error)
    });
  }
});

/**
 * POST /api/billing/payment-methods
 * Store a payment method for future use
 * 
 * Body:
 *   - customerId: string
 *   - paymentMethodId: string (from Stripe.js)
 *   - setAsDefault: boolean (optional)
 */
router.post('/payment-methods', requireAuth, async (req, res) => {
  try {
    const { paymentMethodId, setAsDefault = false } = req.body;
    const customerId = req.customerId;

    if (!paymentMethodId) {
      return res.status(400).json({ error: 'Payment method ID required' });
    }

    // Retrieve payment method to get card details
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

    if (!paymentMethod) {
      return res.status(404).json({ error: 'Payment method not found' });
    }

    const card = paymentMethod.card || {};

    // In production, store this in your database with encrypted fields
    // For now, return the payment method details
    res.json({
      success: true,
      paymentMethodId: paymentMethod.id,
      brand: card.brand,
      lastFour: card.last4,
      expiry: `${card.exp_month}/${card.exp_year}`,
      type: paymentMethod.type,
      billingDetails: paymentMethod.billing_details
    });
  } catch (error) {
    console.error('Store payment method error:', error);
    res.status(500).json({ error: translateStripeError(error) });
  }
});

/**
 * GET /api/billing/payment-methods
 * List stored payment methods for customer
 */
router.get('/payment-methods', requireAuth, async (req, res) => {
  try {
    const customerId = req.customerId;

    // In production, fetch from your database
    // For now, return empty list
    res.json({
      success: true,
      paymentMethods: []
    });
  } catch (error) {
    console.error('List payment methods error:', error);
    res.status(500).json({ error: 'Failed to fetch payment methods' });
  }
});

/**
 * DELETE /api/billing/payment-methods/:id
 * Delete a saved payment method
 */
router.delete('/payment-methods/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // In production, delete from your database
    // For Stripe, payment methods can't be deleted but can be detached
    // await stripe.paymentMethods.detach(id);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete payment method error:', error);
    res.status(500).json({ error: 'Failed to delete payment method' });
  }
});

/**
 * GET /api/billing/payments
 * Get payment history for customer
 */
router.get('/payments', requireAuth, async (req, res) => {
  try {
    const customerId = req.customerId;
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);

    // Stripe's list API does not support filtering by metadata in request params.
    // Pull a bounded set and filter by customerId server-side.
    const paymentIntents = await stripe.paymentIntents.list({
      limit: Math.max(limit * 3, 25)
    });

    const payments = paymentIntents.data
      .filter((pi) => pi && pi.metadata && pi.metadata.customerId === customerId)
      .slice(0, limit)
      .map((pi) => ({
        id: pi.id,
        amount: pi.amount / 100, // Convert from cents
        currency: pi.currency.toUpperCase(),
        status: pi.status,
        date: new Date(pi.created * 1000).toISOString(),
        receiptUrl: pi.charges.data[0]?.receipt_url,
        description: pi.description
      }));

    res.json({
      success: true,
      payments
    });
  } catch (error) {
    console.error('Payment history error:', error);
    res.status(500).json({ error: 'Failed to fetch payment history' });
  }
});

/**
 * POST /api/billing/refund
 * Refund a payment (admin only)
 * 
 * Body:
 *   - paymentIntentId: string
 *   - reason: string (requested_by_customer, fraud, etc)
 *   - notes: string (optional)
 */
router.post('/refund', requireAdmin, async (req, res) => {
  try {
    const { paymentIntentId, reason = 'requested_by_customer', notes } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({ error: 'Payment intent ID required' });
    }

    // Get the payment intent to find the charge
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (!paymentIntent || !paymentIntent.charges.data[0]) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const chargeId = paymentIntent.charges.data[0].id;

    // Create refund
    const refund = await stripe.refunds.create({
      charge: chargeId,
      reason,
      metadata: {
        notes,
        refundedAt: new Date().toISOString()
      }
    });

    res.json({
      success: refund.status === 'succeeded',
      refundId: refund.id,
      status: refund.status,
      amount: refund.amount / 100
    });
  } catch (error) {
    console.error('Refund error:', error);
    res.status(500).json({ error: translateStripeError(error) });
  }
});

/**
 * POST /api/billing/webhook
 * Stripe webhook endpoint
 * Verify webhook signature and process events
 * 
 * Events processed:
 * - payment_intent.succeeded
 * - payment_intent.payment_failed
 * - charge.refunded
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (error) {
    console.error('Webhook signature verification failed:', error.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    // Handle webhook events
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;

      case 'charge.refunded':
        await handleChargeRefunded(event.data.object);
        break;

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * Handle successful payment
 */
async function handlePaymentSucceeded(paymentIntent) {
  console.log('✓ Payment succeeded:', paymentIntent.id);
  
  // In production:
  // 1. Update payment record in database with status 'completed'
  // 2. Log to audit_logs
  // 3. Send confirmation email to customer
  // 4. Trigger fulfillment workflow
  // 5. Update subscription/plan status if applicable

  const customerId = paymentIntent.metadata?.customerId;
  if (customerId) {
    console.log(`  Customer: ${customerId}`);
    console.log(`  Amount: ${paymentIntent.amount / 100} ${paymentIntent.currency.toUpperCase()}`);
  }
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(paymentIntent) {
  console.error('✗ Payment failed:', paymentIntent.id);
  
  // In production:
  // 1. Update payment record in database with status 'failed'
  // 2. Log to audit_logs with failure reason
  // 3. Send notification to customer with retry options
  // 4. Alert admin if fraud is suspected
  // 5. Update customer account status if balance due

  const customerId = paymentIntent.metadata?.customerId;
  if (customerId) {
    console.error(`  Customer: ${customerId}`);
    console.error(`  Last error: ${paymentIntent.last_payment_error?.message}`);
  }
}

/**
 * Handle charge refund
 */
async function handleChargeRefunded(charge) {
  console.log('✓ Charge refunded:', charge.id);
  
  // In production:
  // 1. Find corresponding payment record in database
  // 2. Update payment status to 'refunded'
  // 3. Log refund to audit_logs
  // 4. Send refund confirmation email
  // 5. Update subscription status if applicable
  // 6. Trigger accounting/reconciliation
}

module.exports = router;
