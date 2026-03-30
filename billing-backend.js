/**
 * billing-backend.js - Secure payment processing backend
 * 
 * CRITICAL SECURITY RULES:
 * 1. NEVER accept raw card data (number, CVV, expiry) in any endpoint
 * 2. ALWAYS use payment processor APIs (Stripe, Square) for tokenization
 * 3. ALWAYS encrypt PII at rest before storing to database
 * 4. ALWAYS validate and sanitize user input
 * 5. ALWAYS use HTTPS in production
 * 6. ALWAYS log all payment operations to audit_logs with redacted sensitive data
 * 7. ALWAYS implement idempotency keys to prevent duplicate charges
 * 8. ALWAYS validate amount and currency before processing
 * 
 * Supported Payment Processors: Stripe, Square, PayPal
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');

class BillingBackend extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      environment: process.env.NODE_ENV || 'development',
      encryptionKey: process.env.ENCRYPTION_KEY || '', // AES-256 key (must be 32 bytes hex)
      paymentProviders: config.paymentProviders || {},
      database: config.database || null,
      auditLogger: config.auditLogger || console,
      ...config
    };
    
    if (!this.config.encryptionKey) {
      throw new Error('ENCRYPTION_KEY environment variable is required for secure billing');
    }
    
    this.validateEncryptionKey();
  }

  validateEncryptionKey() {
    const keyBuffer = Buffer.from(this.config.encryptionKey, 'hex');
    if (keyBuffer.length !== 32) {
      throw new Error('ENCRYPTION_KEY must be 64 hex characters (256-bit AES key)');
    }
  }

  /**
   * Encrypt sensitive data (billing address, name, etc) using AES-256-GCM
   * @param {string} plaintext - Data to encrypt
   * @returns {string} - IV:authTag:ciphertext (hex encoded)
   */
  encryptData(plaintext) {
    try {
      const iv = crypto.randomBytes(16);
      const key = Buffer.from(this.config.encryptionKey, 'hex');
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      
      let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
      ciphertext += cipher.final('hex');
      
      const authTag = cipher.getAuthTag();
      
      // Format: IV:authTag:ciphertext
      return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`;
    } catch (error) {
      this.auditLog('encryption_error', 'data', 'encrypt', { error: error.message }, 500);
      throw new Error('Encryption failed: ' + error.message);
    }
  }

  /**
   * Decrypt sensitive data
   * @param {string} encrypted - IV:authTag:ciphertext
   * @returns {string} - Plaintext data
   */
  decryptData(encrypted) {
    try {
      const [ivHex, authTagHex, ciphertext] = encrypted.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const key = Buffer.from(this.config.encryptionKey, 'hex');
      
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      
      let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
      plaintext += decipher.final('utf8');
      
      return plaintext;
    } catch (error) {
      this.auditLog('decryption_error', 'data', 'decrypt', { error: error.message }, 500);
      throw new Error('Decryption failed: ' + error.message);
    }
  }

  /**
   * Create SHA-256 hash of token for deduplication
   */
  hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Generate secure idempotency key for duplicate prevention
   */
  generateIdempotencyKey() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Validate payment request structure
   */
  validatePaymentRequest(req) {
    const errors = [];
    
    if (!req.customerId) errors.push('customerId is required');
    if (!req.amount || req.amount <= 0) errors.push('amount must be positive');
    if (!req.currency || !/^[A-Z]{3}$/.test(req.currency)) errors.push('currency must be 3-letter ISO code');
    if (!req.paymentMethodId) errors.push('paymentMethodId is required');
    if (!req.idempotencyKey) errors.push('idempotencyKey is required for duplicate prevention');
    
    // NEVER accept raw card data
    if (req.cardNumber || req.cvv || req.expiry) {
      errors.push('Raw card data is not accepted. Use payment processor tokenization instead');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Process payment via tokenized payment method
   * Supports Stripe, Square, PayPal
   */
  async processPayment(customerId, paymentRequest, context = {}) {
    const startTime = Date.now();
    const { auditLogger } = this.config;
    
    // Validate request
    const validation = this.validatePaymentRequest({
      ...paymentRequest,
      customerId
    });
    
    if (!validation.valid) {
      this.auditLog('payment_validation_failed', 'payment', 'create', {
        errors: validation.errors
      }, 400, context);
      
      return {
        success: false,
        error: 'Invalid payment request: ' + validation.errors.join(', '),
        statusCode: 400
      };
    }

    try {
      // Check for duplicate payment using idempotency key
      const isDuplicate = await this.checkIdempotency(paymentRequest.idempotencyKey);
      if (isDuplicate) {
        this.auditLog('payment_duplicate_detected', 'payment', 'create', {
          idempotencyKey: paymentRequest.idempotencyKey
        }, 409, context);
        
        return {
          success: false,
          error: 'Duplicate payment request detected',
          statusCode: 409
        };
      }

      // Call payment processor based on method
      const paymentMethod = await this.getPaymentMethod(customerId, paymentRequest.paymentMethodId);
      if (!paymentMethod) {
        this.auditLog('payment_method_not_found', 'payment_method', 'view', {}, 404, context);
        return {
          success: false,
          error: 'Payment method not found',
          statusCode: 404
        };
      }

      const processor = paymentMethod.provider;
      let chargeResult;
      
      if (processor === 'stripe') {
        chargeResult = await this.chargeWithStripe(customerId, paymentMethod, paymentRequest, context);
      } else if (processor === 'square') {
        chargeResult = await this.chargeWithSquare(customerId, paymentMethod, paymentRequest, context);
      } else if (processor === 'paypal') {
        chargeResult = await this.chargeWithPayPal(customerId, paymentMethod, paymentRequest, context);
      } else {
        return {
          success: false,
          error: `Unknown payment processor: ${processor}`,
          statusCode: 400
        };
      }

      if (chargeResult.success) {
        // Create payment record in database
        const paymentRecord = await this.createPaymentRecord(
          customerId,
          paymentRequest,
          chargeResult,
          context
        );

        this.auditLog('payment_completed', 'payment', 'create', {
          amount: paymentRequest.amount,
          currency: paymentRequest.currency,
          transactionRef: chargeResult.transactionReference,
          duration: Date.now() - startTime
        }, 200, context);

        return {
          success: true,
          paymentId: paymentRecord.payment_id,
          transactionReference: chargeResult.transactionReference,
          receiptUrl: chargeResult.receiptUrl,
          statusCode: 200
        };
      } else {
        this.auditLog('payment_failed', 'payment', 'create', {
          error: chargeResult.error,
          duration: Date.now() - startTime
        }, 402, context);

        return {
          success: false,
          error: chargeResult.error,
          statusCode: 402
        };
      }
    } catch (error) {
      this.auditLog('payment_error', 'payment', 'create', {
        error: error.message,
        stack: error.stack.substring(0, 500)
      }, 500, context);

      return {
        success: false,
        error: 'Payment processing error',
        statusCode: 500
      };
    }
  }

  /**
   * Store payment method using processor token
   */
  async storePaymentMethod(customerId, processorToken, context = {}) {
    try {
      if (!processorToken) {
        this.auditLog('payment_method_invalid', 'payment_method', 'create', {
          error: 'Token is required'
        }, 400, context);
        return { success: false, error: 'Token is required' };
      }

      // Get card details from processor
      const cardDetails = await this.getCardDetailsFromProcessor(processorToken);
      
      // Generate fingerprint to prevent duplicates
      const fingerprint = this.hashToken(processorToken);
      
      // Encrypt sensitive fields
      const encryptedBillingName = cardDetails.billingName 
        ? this.encryptData(cardDetails.billingName) 
        : null;
      const encryptedBillingAddress = cardDetails.billingAddress 
        ? this.encryptData(cardDetails.billingAddress) 
        : null;
      const encryptedBillingZip = cardDetails.billingZip 
        ? this.encryptData(cardDetails.billingZip) 
        : null;

      // Store (implementation depends on your database)
      const result = await this.config.database?.query(
        `INSERT INTO payment_methods 
         (customer_id, provider, card_brand, last_four, expiry_month, expiry_year,
          billing_name_encrypted, billing_address_encrypted, billing_zip_encrypted, 
          token, token_fingerprint, is_default, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          customerId,
          cardDetails.provider,
          cardDetails.brand,
          cardDetails.lastFour,
          cardDetails.expiryMonth,
          cardDetails.expiryYear,
          encryptedBillingName,
          encryptedBillingAddress,
          encryptedBillingZip,
          processorToken,
          fingerprint,
          false,
          JSON.stringify({ source: 'api' })
        ]
      );

      this.auditLog('payment_method_stored', 'payment_method', 'create', {
        cardBrand: cardDetails.brand,
        lastFour: cardDetails.lastFour,
        duration: Date.now() - context.startTime
      }, 201, context);

      return {
        success: true,
        paymentMethodId: result.insertedId,
        lastFour: cardDetails.lastFour,
        brand: cardDetails.brand
      };
    } catch (error) {
      this.auditLog('payment_method_error', 'payment_method', 'create', {
        error: error.message
      }, 500, context);

      return {
        success: false,
        error: 'Failed to store payment method'
      };
    }
  }

  /**
   * Charge using Stripe
   */
  async chargeWithStripe(customerId, paymentMethod, paymentRequest, context) {
    try {
      const stripe = this.config.paymentProviders.stripe;
      if (!stripe) {
        throw new Error('Stripe provider not configured');
      }

      // Import Stripe utilities
      const { formatAmountForStripe, translateStripeError } = require('./stripe-config');

      // Create payment intent with idempotency key for duplicate prevention
      const paymentIntent = await stripe.paymentIntents.create(
        {
          amount: formatAmountForStripe(paymentRequest.amount, paymentRequest.currency),
          currency: paymentRequest.currency.toLowerCase(),
          payment_method: paymentMethod.token,
          confirm: true,
          description: `${process.env.STRIPE_DESCRIPTION_PREFIX || 'Payment'} - Customer: ${customerId}`,
          metadata: {
            customerId,
            transactionReference: paymentRequest.transactionReference || paymentRequest.idempotencyKey,
            ...paymentRequest.metadata
          },
          receipt_email: context.email || undefined,
          return_url: context.returnUrl || `${process.env.RETURN_URL}/payment-success`
        },
        {
          idempotencyKey: paymentRequest.idempotencyKey
        }
      );

      // Check if payment succeeded
      if (paymentIntent.status === 'succeeded') {
        return {
          success: true,
          transactionReference: paymentIntent.id,
          chargeId: paymentIntent.charges.data[0]?.id,
          receiptUrl: paymentIntent.charges.data[0]?.receipt_url,
          status: 'completed',
          processor: 'stripe'
        };
      } else if (paymentIntent.status === 'requires_action') {
        // 3D Secure or other authentication required
        return {
          success: false,
          error: 'Additional authentication required',
          requiresAction: true,
          clientSecret: paymentIntent.client_secret,
          processor: 'stripe'
        };
      } else if (paymentIntent.status === 'processing') {
        return {
          success: false,
          error: 'Payment is processing. Please check back in a moment.',
          status: 'processing',
          processor: 'stripe'
        };
      } else {
        return {
          success: false,
          error: `Payment failed with status: ${paymentIntent.status}`,
          processor: 'stripe'
        };
      }
    } catch (error) {
      // Stripe-specific error handling
      const { translateStripeError } = require('./stripe-config');
      
      return {
        success: false,
        error: translateStripeError(error),
        code: error.code,
        processor: 'stripe'
      };
    }
  }

  /**
   * Charge using Square (stub - implement with actual Square API)
   */
  async chargeWithSquare(customerId, paymentMethod, paymentRequest, context) {
    // TODO: Implement Square charge via their API
    throw new Error('Square integration not yet implemented');
  }

  /**
   * Charge using PayPal (stub - implement with actual PayPal API)
   */
  async chargeWithPayPal(customerId, paymentMethod, paymentRequest, context) {
    // TODO: Implement PayPal charge via their API
    throw new Error('PayPal integration not yet implemented');
  }

  /**
   * Get payment method from database
   */
  async getPaymentMethod(customerId, paymentMethodId) {
    // Implementation depends on your database
    return null;
  }

  /**
   * Check for duplicate payment using idempotency key
   */
  async checkIdempotency(idempotencyKey) {
    // Check database for existing payment with this idempotency key
    return false;
  }

  /**
   * Create payment record in database
   */
  async createPaymentRecord(customerId, paymentRequest, chargeResult, context) {
    // Implementation depends on your database
    return { payment_id: crypto.randomUUID() };
  }

  /**
   * Get card details from Stripe payment method
   */
  async getCardDetailsFromProcessor(token) {
    try {
      const stripe = this.config.paymentProviders.stripe;
      if (!stripe) {
        throw new Error('Stripe provider not configured');
      }

      // Retrieve payment method from Stripe
      const paymentMethod = await stripe.paymentMethods.retrieve(token);

      if (!paymentMethod) {
        throw new Error('Payment method not found');
      }

      const card = paymentMethod.card || {};
      const billingDetails = paymentMethod.billing_details || {};

      return {
        provider: 'stripe',
        brand: card.brand || 'unknown',
        lastFour: card.last4 || 'unknown',
        expiryMonth: card.exp_month,
        expiryYear: card.exp_year,
        billingName: billingDetails.name,
        billingAddress: billingDetails.address?.line1,
        billingZip: billingDetails.address?.postal_code,
        token,
        fingerprint: card.fingerprint
      };
    } catch (error) {
      this.auditLog('card_details_error', 'payment_method', 'view', {
        error: error.message
      }, 400);
      throw new Error('Failed to retrieve card details: ' + error.message);
    }
  }

  /**
   * Audit log all payment operations
   * NEVER log raw card data, amounts > 2 decimals should NOT be logged
   */
  auditLog(eventType, resourceType, action, eventData = {}, statusCode = 200, context = {}) {
    // Redact sensitive information
    const redactedData = {
      ...eventData,
      // Remove any card numbers or CVV
      cardNumber: undefined,
      cvv: undefined,
      token: undefined
    };

    const logEntry = {
      timestamp: new Date().toISOString(),
      eventType,
      resourceType,
      action,
      resourceId: context.resourceId || 'unknown',
      eventData: redactedData,
      httpStatus: statusCode,
      ipAddress: context.ipAddress || 'unknown',
      userAgent: context.userAgent || 'unknown',
      customerId: context.customerId || null
    };

    // Log to audit logger
    if (this.config.auditLogger) {
      if (statusCode >= 400) {
        this.config.auditLogger.warn(logEntry);
      } else {
        this.config.auditLogger.info(logEntry);
      }
    }

    // Emit event for real-time monitoring
    this.emit('audit', logEntry);
  }

  /**
   * Refund a payment
   * Only authorized staff can refund
   */
  async refundPayment(paymentId, reason = '', context = {}) {
    if (!context.adminId) {
      this.auditLog('refund_unauthorized', 'payment', 'update', { error: 'Admin required' }, 403, context);
      return { success: false, error: 'Unauthorized' };
    }

    try {
      // Get original payment
      const payment = await this.getPayment(paymentId);
      if (!payment) {
        return { success: false, error: 'Payment not found' };
      }

      // Call payment processor refund
      const refundResult = await this.refundWithProcessor(payment, reason);
      
      if (refundResult.success) {
        // Update payment status to refunded
        await this.updatePaymentStatus(paymentId, 'refunded');
        
        this.auditLog('payment_refunded', 'payment', 'update', {
          originalAmount: payment.amount,
          refundReason: reason,
          processedBy: context.adminId
        }, 200, context);

        return { success: true };
      } else {
        return { success: false, error: refundResult.error };
      }
    } catch (error) {
      this.auditLog('refund_error', 'payment', 'update', { error: error.message }, 500, context);
      return { success: false, error: 'Refund failed' };
    }
  }

  /**
   * Get payment details
   */
  async getPayment(paymentId) {
    // Implementation depends on database
    return null;
  }

  /**
   * Refund with Stripe
   */
  async refundWithProcessor(payment, reason) {
    try {
      const stripe = this.config.paymentProviders.stripe;
      if (!stripe) {
        throw new Error('Stripe provider not configured');
      }

      // Get the charge ID from payment processor ID field
      const chargeId = payment.payment_processor_id;
      if (!chargeId) {
        throw new Error('No charge ID found for refund');
      }

      // Create refund in Stripe
      const refund = await stripe.refunds.create({
        charge: chargeId,
        reason: reason === 'requested_by_customer' ? 'requested_by_customer' : 'other',
        metadata: {
          refundReason: reason,
          originalPaymentId: payment.payment_id
        }
      });

      return {
        success: refund.status === 'succeeded',
        refundId: refund.id,
        status: refund.status,
        amount: refund.amount
      };
    } catch (error) {
      const { translateStripeError } = require('./stripe-config');
      
      return {
        success: false,
        error: translateStripeError(error)
      };
    }
  }

  /**
   * Update payment status
   */
  async updatePaymentStatus(paymentId, status) {
    // Implementation depends on database
  }
}

module.exports = BillingBackend;
