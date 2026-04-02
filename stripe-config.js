/**
 * stripe-config.js - Stripe payment processor configuration
 * 
 * Initializes Stripe SDK with test/live mode based on environment
 * Handles API version, timeout, and retry logic
 */

const stripe = require('stripe')(
  process.env.NODE_ENV === 'production' 
    ? process.env.STRIPE_SECRET_KEY_LIVE 
    : process.env.STRIPE_SECRET_KEY,
  {
    apiVersion: process.env.STRIPE_API_VERSION || '2023-10-16',
    timeout: 30000,
    maxNetworkRetries: 2,
    telemetry: false // Disable telemetry in production
  }
);

/**
 * Get Stripe configuration for billing — never includes secret keys.
 */
const getStripeConfig = () => ({
  publicKey: process.env.NODE_ENV === 'production' 
    ? process.env.STRIPE_PUBLIC_KEY_LIVE 
    : process.env.STRIPE_PUBLIC_KEY,
  mode: process.env.NODE_ENV === 'production' ? 'live' : 'test',
  apiVersion: process.env.STRIPE_API_VERSION || '2023-10-16'
});

/**
 * Test Stripe connectivity
 */
const testStripeConnection = async () => {
  try {
    await stripe.balance.retrieve();
    console.log('✓ Stripe connection successful');
    return true;
  } catch (error) {
    console.error('✗ Stripe connection failed:', error.message);
    return false;
  }
};

/**
 * Create Stripe customer for billing
 */
const createStripeCustomer = async (email, metadata = {}) => {
  try {
    const customer = await stripe.customers.create({
      email,
      description: `Customer from ${process.env.STRIPE_DESCRIPTION_PREFIX || 'Creative Web Solutions'}`,
      metadata: {
        source: 'portal',
        ...metadata
      }
    });
    return { success: true, customer };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Format amount for Stripe (convert to smallest currency unit)
 * @param {number} amount - Amount in dollars/euros/etc
 * @param {string} currency - ISO 4217 currency code
 * @returns {number} Amount in cents/pence/etc
 */
const formatAmountForStripe = (amount, currency = 'USD') => {
  // Most currencies use 2 decimal places
  // Japan (JPY), South Korea (KRW), etc use 0
  const zeroDecimalCurrencies = new Set(['JPY', 'KRW', 'TWD', 'VND', 'XAF', 'XOF', 'XPF']);
  
  if (zeroDecimalCurrencies.has(currency.toUpperCase())) {
    return Math.round(amount);
  }
  
  return Math.round(amount * 100);
};

/**
 * Format Stripe amount for display
 */
const formatAmountForDisplay = (amount, currency = 'USD') => {
  const zeroDecimalCurrencies = new Set(['JPY', 'KRW', 'TWD', 'VND', 'XAF', 'XOF', 'XPF']);
  
  if (zeroDecimalCurrencies.has(currency.toUpperCase())) {
    return amount;
  }
  
  return (amount / 100).toFixed(2);
};

/**
 * Stripe error code mapping
 */
const stripeErrorCodes = {
  'card_declined': 'Your card was declined. Please try another payment method.',
  'expired_card': 'Your card has expired. Please use a different card.',
  'lost_card': 'This card has been reported as lost.',
  'stolen_card': 'This card has been reported as stolen.',
  'insufficient_funds': 'Insufficient funds available.',
  'incorrect_cvc': 'Your card\'s security code is incorrect.',
  'processing_error': 'An error occurred while processing your payment. Please try again.',
  'rate_limit': 'Too many requests. Please wait a moment and try again.',
  'authentication_error': 'Authentication failed. Please check your card details.',
  'invalid_account': 'The card is not valid.',
  'do_not_honor': 'The card do not honor this transaction.',
  'generic_decline': 'Your card was declined. Please contact your bank.',
  'generic_decline_generic': 'Your card was declined. Please try again or contact your bank.',
  'fraudulent': 'Your card was flagged as potentially fraudulent.',
};

/**
 * Translate Stripe error to user-friendly message
 */
const translateStripeError = (error) => {
  if (!error) return 'An unexpected error occurred.';

  // Handle Stripe API errors
  if (error.type === 'StripeCardError') {
    return stripeErrorCodes[error.code] || error.message || 'Your card was declined.';
  }

  if (error.type === 'StripeRateLimitError') {
    return 'Too many requests. Please wait a moment and try again.';
  }

  if (error.type === 'StripeInvalidRequestError') {
    return 'Invalid payment request. Please check your information and try again.';
  }

  if (error.type === 'StripeAPIError') {
    return 'Payment service temporarily unavailable. Please try again in a moment.';
  }

  if (error.type === 'StripeConnectionError') {
    return 'Network error. Please check your connection and try again.';
  }

  if (error.type === 'StripeAuthenticationError') {
    return 'Authentication error. Please contact support.';
  }

  if (error.type === 'StripePermissionError') {
    return 'Permission denied. Please contact support.';
  }

  return error.message || 'An unexpected error occurred.';
};

module.exports = {
  stripe,
  getStripeConfig,
  testStripeConnection,
  createStripeCustomer,
  formatAmountForStripe,
  formatAmountForDisplay,
  translateStripeError,
  stripeErrorCodes
};
